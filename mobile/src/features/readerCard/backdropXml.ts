const FILTER_ID = "backdropBlur";

export function cardViewBox(svg: string): readonly [number, number, number, number] {
  return /viewBox="([^"]+)"/.exec(svg)![1]!.split(/[\s,]+/).map(Number) as unknown as [number, number, number, number];
}

export function backdropXml(svg: string, stdDeviation: number): string {
  const root = /<svg\b[^>]*>/.exec(svg)![0];
  const slicedRoot = root.replace(/\spreserveAspectRatio="[^"]*"/, "").replace(/>$/, ' preserveAspectRatio="xMidYMid slice">');
  const filter = `<filter id="${FILTER_ID}" x="-100%" y="-100%" width="300%" height="300%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${stdDeviation}"/><feColorMatrix type="saturate" values="1.4"/></filter>`;
  const open = `${slicedRoot}<defs>${filter}</defs><g filter="url(#${FILTER_ID})">`;
  const close = svg.lastIndexOf("</svg>");
  return `${open}${svg.slice(root.length, close)}</g>${svg.slice(close)}`;
}
