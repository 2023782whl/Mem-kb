import { App as AntApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import type { ReactNode } from "react";
import { MotionConfig } from "motion/react";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={{ duration: .2, ease: "easeOut" }}><ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: "#b75a0c",
          colorInfo: "#4d7cfe",
          colorSuccess: "#18b981",
          colorWarning: "#d98a2b",
          colorError: "#eb5757",
          colorText: "#1f2329",
          colorTextSecondary: "#646a73",
          colorBorder: "#dee0e3",
          colorBgLayout: "#f5f6f7",
          colorBgContainer: "#ffffff",
          borderRadius: 8,
          borderRadiusLG: 12,
          fontFamily: 'Inter, "SF Pro Text", "PingFang SC", "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif'
        },
        components: {
          Button: { controlHeight: 38, fontWeight: 650 },
          Input: { controlHeight: 40 },
          Modal: { titleFontSize: 17 }
        }
      }}
    >
      <AntApp>{children}</AntApp>
    </ConfigProvider></MotionConfig>
  );
}
