import OpengraphImage from "./opengraph-image";

// Same card as opengraph-image.tsx — X/Twitter reads twitter:image
// separately from og:image, and Next only emits it from this file.
// size/contentType/alt are declared here rather than re-exported
// since Next reads them from this file's own exports.
export const alt = "The Weekend — fantasy football, with a memory";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default OpengraphImage;
