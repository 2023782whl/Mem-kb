import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

const getComputedStyle = window.getComputedStyle.bind(window);
window.getComputedStyle = (element: Element) => getComputedStyle(element);

window.localStorage.setItem("mem_kb_locale", "zh-CN");
beforeEach(() => window.localStorage.setItem("mem_kb_locale", "zh-CN"));
afterEach(cleanup);
