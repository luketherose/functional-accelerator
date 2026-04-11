import { useTranslation } from 'react-i18next';
import { LANGUAGES, setLanguage, type LangCode } from '../../i18n';

export default function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const current = i18n.language as LangCode;

  return (
    <div className="flex gap-0.5 rounded-lg bg-white/10 p-0.5">
      {LANGUAGES.map(lang => (
        <button
          key={lang.code}
          onClick={() => setLanguage(lang.code)}
          className={`px-2 py-0.5 rounded-md text-[10px] font-semibold transition-all ${
            current === lang.code
              ? 'bg-white text-purple-deep'
              : 'text-white/50 hover:text-white'
          }`}
        >
          {lang.label}
        </button>
      ))}
    </div>
  );
}
