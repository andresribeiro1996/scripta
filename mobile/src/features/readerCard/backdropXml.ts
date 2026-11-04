export function backdropXml(svg: string): string {
  const root = /<svg\b[^>]*>/.exec(svg)![0];
  return svg.replace(root, root.replace(/\spreserveAspectRatio="[^"]*"/, "").replace(/>$/, ' preserveAspectRatio="xMidYMid slice">'));
}

const VIEW_BLUR_MIN_ANDROID_API = 31;

export function viewBlurSupported(os: string, version: number | string): boolean {
  return os === "android" && Number(version) >= VIEW_BLUR_MIN_ANDROID_API;
}
