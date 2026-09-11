import { createRoot } from "react-dom/client";
import { html } from "./lib.js";
import { Root } from "./Root.js";

createRoot(document.getElementById("root")).render(html`<${Root} />`);
