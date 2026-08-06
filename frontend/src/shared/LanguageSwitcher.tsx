import { Check, ChevronDown, Languages } from "lucide-react";
import { Dropdown, type MenuProps } from "antd";
import { useI18n, type AppLocale } from "../i18n";

const OPTIONS: Array<{ locale: AppLocale; label: string; shortLabel: string }> = [
  { locale: "zh-CN", label: "中文", shortLabel: "中" },
  { locale: "en-US", label: "English", shortLabel: "EN" },
];

export function LanguageSwitcher({ fullLabel = false }: { fullLabel?: boolean }) {
  const { locale, setLocale } = useI18n();
  const active = OPTIONS.find((option) => option.locale === locale) || OPTIONS[0];
  const items: MenuProps["items"] = OPTIONS.map((option) => ({
    key: option.locale,
    label: <span className="language-menu-label"><span>{option.label}</span><Check className={locale === option.locale ? "visible" : ""} /></span>,
  }));

  return (
    <Dropdown
      menu={{ items, onClick: ({ key }) => setLocale(key as AppLocale) }}
      placement="bottomRight"
      trigger={["click"]}
    >
      <button
        type="button"
        data-i18n-ignore
        className={`language-switcher ${fullLabel ? "full-label" : ""}`}
        aria-label={locale === "zh-CN" ? "切换语言" : "Switch language"}
        data-tooltip={locale === "zh-CN" ? "切换语言" : "Switch language"}
      >
        <Languages />
        <span>{fullLabel ? active.label : active.shortLabel}</span>
        <ChevronDown />
      </button>
    </Dropdown>
  );
}
