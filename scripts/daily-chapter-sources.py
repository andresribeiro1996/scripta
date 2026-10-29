import concurrent.futures
import hashlib
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.request import Request, urlopen

NS = {"o": "http://www.idpf.org/2007/opf", "d": "http://purl.org/dc/elements/1.1/", "h": "http://www.w3.org/1999/xhtml"}
EPUB = "{http://www.idpf.org/2007/ops}type"


def normalized(text):
    return " ".join(text.split())


def passages(data):
    root = ET.fromstring(data)
    body = root.find("h:body", NS)
    if body is None or "bodymatter" not in body.get(EPUB, "").split():
        return []
    parents = {child: parent for parent in root.iter() for child in parent}
    result = []
    for index, paragraph in enumerate(body.iter("{" + NS["h"] + "}p"), 1):
        ancestor = paragraph
        excluded = False
        section = ""
        while ancestor is not body:
            if ancestor.tag.rsplit("}", 1)[-1] in {"header", "footer", "aside"} or set(ancestor.get(EPUB, "").split()) & {"epigraph", "endnote", "footnote", "se:bridgehead", "title"}:
                excluded = True
            if not section and ancestor.get("id"):
                section = ancestor.get("id")
            ancestor = parents[ancestor]
        if excluded or any("noteref" in node.get(EPUB, "").split() for node in paragraph.iter()):
            continue
        text = normalized("".join(paragraph.itertext()))
        if 8 <= len(text.split()) <= 60 and text[-1:] in ".!?\u201d\u2019\"'" and text not in {item["text"] for item in result}:
            result.append({"text": text, "paragraph": index, "section": section})
    return result


def fetch(source, cache):
    repository, revision = source["repository"], source["revision"]
    if not re.fullmatch(r"[a-z0-9_-]+", repository) or not re.fullmatch(r"[a-f0-9]{40}", revision):
        raise ValueError("Invalid source repository or revision")
    folder = cache / repository / revision
    folder.mkdir(parents=True, exist_ok=True)

    def read(href):
        if not re.fullmatch(r"[a-zA-Z0-9_./-]+", href) or ".." in href.split("/"):
            raise ValueError("Invalid source path")
        target = folder / href
        if not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            url = f"https://raw.githubusercontent.com/standardebooks/{repository}/{revision}/src/epub/{href}"
            with urlopen(Request(url, headers={"User-Agent": "Atmyshelf-editorial-research/1.0"}), timeout=45) as response:
                data = response.read()
            ET.fromstring(data)
            target.write_bytes(data)
        return target.read_bytes()

    opf = read("content.opf")
    root = ET.fromstring(opf)
    metadata = root.find("o:metadata", NS)
    title = normalized("".join(metadata.find("d:title", NS).itertext()))
    creators = [normalized("".join(node.itertext())) for node in metadata.findall("d:creator", NS)]
    translator_ids = {node.get("refines", "").removeprefix("#") for node in metadata.findall("o:meta", NS) if node.get("property") == "role" and node.text == "trl"}
    translators = [normalized("".join(node.itertext())) for node in metadata.findall("d:contributor", NS) if node.get("id") in translator_ids]
    manifest = {node.get("id"): node.get("href") for node in root.findall("o:manifest/o:item", NS)}
    chapters = []
    for item in root.findall("o:spine/o:itemref", NS):
        href = manifest[item.get("idref")]
        data = read(href)
        candidates = passages(data)
        if candidates:
            chapters.append([{**candidate, "path": "src/epub/" + href, "fileSha256": hashlib.sha256(data).hexdigest()} for candidate in candidates])
        if len(chapters) >= 3 and sum(map(len, chapters)) >= 5:
            break
    selected = []
    while len(selected) < 5 and any(chapters):
        for chapter in chapters:
            while chapter:
                candidate = chapter.pop(0)
                if candidate["text"] not in {item["text"] for item in selected}:
                    selected.append(candidate)
                    break
            if len(selected) == 5:
                break
    if len(selected) != 5:
        raise ValueError(f"Only {len(selected)} distinct passages in {repository}")
    return {**source, "title": title, "author": ", ".join(creators), "language": "en", "sourceLanguage": metadata.findtext("d:language", namespaces=NS), "translators": translators, "metadataSha256": hashlib.sha256(opf).hexdigest(), "passages": selected}


if __name__ == "__main__":
    sources = json.loads(Path(sys.argv[1]).read_text())
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        result = list(pool.map(lambda source: fetch(source, Path(sys.argv[2])), sources))
    Path(sys.argv[3]).write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(f"Extracted {sum(len(source['passages']) for source in result)} source-matched passages from {len(result)} editions")
