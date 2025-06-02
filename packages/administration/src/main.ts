import { createApp } from "vue";
import { location } from "@shopware-ag/meteor-admin-sdk";
import "./main.css";
import App from "./App.vue";
import { createTranslator } from "./snippets";

const urlParams = new URLSearchParams(window.location.search);
const language =
    urlParams.get("sw-user-language") || (navigator.languages && navigator.languages[0]) || "en-GB";
const i18n = createTranslator(language);

location.startAutoResizer();

const app = createApp(App);
app.use(i18n);
app.mount("#app");
