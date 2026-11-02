const FILTER_ID = "backdropBlur";

export function backdropXml(svg: string): string {
  const root = /<svg\b[^>]*>/.exec(svg)![0];
  const slicedRoot = root.replace(/\spreserveAspectRatio="[^"]*"/, "").replace(/>$/, ' preserveAspectRatio="xMidYMid slice">');
  const open = `${slicedRoot}<defs><filter id="${FILTER_ID}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="18"/></filter></defs><g filter="url(#${FILTER_ID})">`;
  const close = svg.lastIndexOf("</svg>");
  return `${open}${svg.slice(root.length, close)}</g>${svg.slice(close)}`;
}
