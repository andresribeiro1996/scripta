const FILTER_ID = "backdropBlur";
const BLUR = 80;
const SCALE = 1.6;

export function backdropXml(svg: string): string {
  const root = /<svg\b[^>]*>/.exec(svg)![0];
  const slicedRoot = root.replace(/\spreserveAspectRatio="[^"]*"/, "").replace(/>$/, ' preserveAspectRatio="xMidYMid slice">');
  const [x, y, w, h] = /viewBox="([^"]+)"/.exec(root)![1]!.split(/[\s,]+/).map(Number) as [number, number, number, number];
  const cx = x + w / 2;
  const cy = y + h / 2;
  const open = `${slicedRoot}<defs><filter id="${FILTER_ID}" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="${BLUR}"/></filter></defs><g filter="url(#${FILTER_ID})"><g transform="translate(${cx} ${cy}) scale(${SCALE}) translate(${-cx} ${-cy})">`;
  const close = svg.lastIndexOf("</svg>");
  return `${open}${svg.slice(root.length, close)}</g></g>${svg.slice(close)}`;
}
