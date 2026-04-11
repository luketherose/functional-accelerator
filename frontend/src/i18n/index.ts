import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en';
import it from './locales/it';

export const LANGUAGES = [
  { code: 'en', label: 'EN' },
  { code: 'it', label: 'IT' },
] as const;

export type LangCode = (typeof LANGUAGES)[number]['code'];

const saved = localStorage.getItem('lang') as LangCode | null;
const initial: LangCode = saved && ['en', 'it'].includes(saved) ? saved : 'en';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      it: { translation: it },
    },
    lng: initial,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false, // React already escapes
    },
  });

export function setLanguage(lang: LangCode) {
  i18n.changeLanguage(lang);
  localStorage.setItem('lang', lang);
}

export default i18n;
