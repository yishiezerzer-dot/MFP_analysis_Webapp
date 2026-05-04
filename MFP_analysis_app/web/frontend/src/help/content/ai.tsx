import type { HelpModule } from "../types";
import { DocCode, DocH4, DocLead, DocLi, DocNote, DocOl, DocP, DocUl } from "../docPrimitives";

export const aiHelpModule: HelpModule = {
  title: "AI Assistant — help",
  topics: [
    {
      id: "overview",
      title: "Overview",
      keywords: ["chat", "llm", "assistant"],
      body: (
        <DocLead>
          The AI Assistant sends your prompts (and optional structured context about loaded sessions) to a configured
          provider: Demo (offline canned logic), OpenAI-compatible API, or local Ollama. It is <strong>read-only</strong>:
          it cannot mutate mzML, plates, or workspaces—only describe workflows and suggest steps.
        </DocLead>
      ),
    },
    {
      id: "providers",
      title: "Providers and models",
      keywords: ["openai", "ollama", "demo", "api key"],
      body: (
        <>
          <DocUl>
            <DocLi>
              <strong>Demo</strong> uses lightweight mock responses—no network required.
            </DocLi>
            <DocLi>
              <strong>OpenAI</strong> requires server-side configuration (keys are not stored in the React bundle); the UI
              shows availability from <DocCode>/api/ai/...</DocCode> status endpoints.
            </DocLi>
            <DocLi>
              <strong>Ollama</strong> expects a reachable base URL (default <DocCode>http://127.0.0.1:11434</DocCode>) and
              a model tag that exists locally.
            </DocLi>
            <DocLi>
              <strong>Model field</strong> overrides the default model name sent with chat requests when non-empty.
            </DocLi>
          </DocUl>
          <DocNote>
            Never paste secrets into chat messages; provider credentials belong in environment variables on the backend.
          </DocNote>
        </>
      ),
    },
    {
      id: "context",
      title: "Context panel",
      keywords: ["sessions", "module", "snapshot"],
      body: (
        <>
          <DocH4>Include context</DocH4>
          <DocP>
            When enabled, the next chat request may attach a compact summary of loaded sessions for the selected modules
            (filenames, counts, simple stats). This helps the model answer “what’s loaded?” style questions.
          </DocP>
          <DocH4>Active module focus</DocH4>
          <DocP>
            Narrows contextual hints to LCMS vs FTIR vs Plate Reader vs Data Studio so answers reference the right
            vocabulary (RT, wavenumber, wells, columns).
          </DocP>
          <DocH4>Session checkboxes</DocH4>
          <DocP>
            Choose which session IDs are included when multiple are open. Use <strong>Refresh</strong> after loading new
            files to rebuild the snapshot.
          </DocP>
        </>
      ),
    },
    {
      id: "chat-column",
      title: "Chat column",
      keywords: ["message", "export", "clear"],
      body: (
        <>
          <DocUl>
            <DocLi>Messages alternate user vs assistant bubbles with timestamps implicit in order.</DocLi>
            <DocLi>
              <strong>Export transcript</strong> downloads plain text of the conversation.
            </DocLi>
            <DocLi>
              <strong>Clear chat</strong> wipes turns locally (does not delete lab data).
            </DocLi>
            <DocLi>Composer supports multiline input; send triggers the API call and shows a typing indicator.</DocLi>
          </DocUl>
        </>
      ),
    },
    {
      id: "starter-prompts",
      title: "Starter prompts",
      keywords: ["prompts", "examples"],
      body: (
        <DocP>
          Empty-state chips seed the composer with common lab questions (e.g. how to preprocess FTIR, interpret MIC
          plots). Clicking a chip fills the input; edit before sending as needed.
        </DocP>
      ),
    },
    {
      id: "limitations",
      title: "Limitations and safety",
      keywords: ["hallucination", "verify"],
      body: (
        <DocOl>
          <DocLi>Models can hallucinate—verify critical numbers against the actual plots and exported tables.</DocLi>
          <DocLi>Large context windows cost tokens; disable context when asking generic questions.</DocLi>
          <DocLi>Demo mode answers are static/heuristic and not suitable for novel research conclusions.</DocLi>
        </DocOl>
      ),
    },
  ],
};
