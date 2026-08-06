import type { QaRequest } from "../qa/service.js";

const IMAGE_INTENT = /(?:图片|照片|海报|素材图|配图|商品图|截图|看图|找.{0,6}图|来.{0,4}张图)/i;
const WEB_INTENT = /(?:联网|网上|全网|最新消息|新闻|实时信息)/i;

export function resolveChannelQaOptions(text: string): NonNullable<QaRequest["options"]> {
  return {
    documentQa: true,
    imageSearch: IMAGE_INTENT.test(text),
    webSearch: WEB_INTENT.test(text)
  };
}
