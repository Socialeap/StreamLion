import { retiredChatGPTResponse } from "../../../server/retired-chatgpt.js";
export const onRequest = ({ request }) => retiredChatGPTResponse(request);
