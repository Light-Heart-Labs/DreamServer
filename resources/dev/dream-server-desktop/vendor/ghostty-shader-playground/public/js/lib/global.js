import { Configuration } from "./config.js";
import { Bus } from "./bus.js";

export const global = {
  shaderList: [],
  wrapper: "",
  video: document.createElement("video"),
  bus: new Bus(),
  config: new Configuration(),
};
