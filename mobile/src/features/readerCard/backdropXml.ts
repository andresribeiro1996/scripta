export function backdropXml(svg: string): string {
  const root = /<svg\b[^>]*>/.exec(svg)![0];
  return svg.replace(root, root.replace(/\spreserveAspectRatio="[^"]*"/, "").replace(/>$/, ' preserveAspectRatio="xMidYMid slice">'));
}
