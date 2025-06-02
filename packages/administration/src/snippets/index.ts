import { createI18n } from "vue-i18n";

export function createTranslator(uiLanguage: string) {
    return createI18n({
        legacy: false,
        locale: uiLanguage.substring(0, 2),
        fallbackLocale: "en",
        messages: {
            en: {},
        },
    });
}
