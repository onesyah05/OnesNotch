import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import id from "./id.json";

export const resources = { en: { translation: en }, id: { translation: id } } as const;
export type Locale = keyof typeof resources;

function detectLocale(): Locale {
  return navigator.language.toLowerCase().startsWith("id") ? "id" : "en";
}

void i18n.use(initReactI18next).init({
  resources,
  lng: detectLocale(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
