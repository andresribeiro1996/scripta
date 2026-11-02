export function backdropXml(svg: string): string {
  const viewBox = /viewBox="([^"]+)"/.exec(svg)![1];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" preserveAspectRatio="xMidYMid slice"><defs><filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="18"/></filter></defs><g filter="url(#blur)">${svg}</g></svg>`;
}
