import { useEffect, useId, useState } from "react";
import { LoadingDots } from "./LoadingSystem";

let initialized = false;

async function getMermaid() {
  const instance = (await import("mermaid")).default;
  if (!initialized) {
    instance.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      fontFamily: "Inter, PingFang SC, Microsoft YaHei, sans-serif",
      themeVariables: {
        primaryColor: "#e8f8f1",
        primaryBorderColor: "#16a36a",
        primaryTextColor: "#16231e",
        lineColor: "#7ea895",
        secondaryColor: "#f5faf8",
        tertiaryColor: "#ffffff"
      }
    });
    initialized = true;
  }
  return instance;
}

export function MermaidDiagram({ source }: { source: string }) {
  const reactId = useId();
  const [attempt, setAttempt] = useState(0);
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const id = `mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}-${attempt}`;
    setSvg("");
    setError("");
    getMermaid().then((instance) => instance.render(id, source)).then((result) => {
      if (active) setSvg(result.svg);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "流程图语法不正确");
    });
    return () => { active = false; };
  }, [attempt, reactId, source]);

  if (error) {
    return (
      <div className="mermaid-fallback">
        <strong>流程图暂时无法渲染</strong>
        <pre><code>{source}</code></pre>
        <button type="button" onClick={() => setAttempt((value) => value + 1)}>重新渲染</button>
      </div>
    );
  }
  if (!svg) return <div className="mermaid-loading"><LoadingDots />正在绘制流程图</div>;
  return <div className="mermaid-diagram" dangerouslySetInnerHTML={{ __html: svg }} />;
}
