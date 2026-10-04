import type { HelpModule } from "../types";
import { DocCode, DocLead, DocLi, DocNote, DocP, DocUl } from "../docPrimitives";

export const aiHelpModule: HelpModule = {
  title: "AI Assistant — help",
  topics: [
    {
      id: "overview",
      title: "Overview",
      keywords: ["chat", "llm", "assistant", "start"],
      body: (
        <>
          <DocLead>
            Ask questions about the app or your open data, or ask the assistant to do something — "create an EIC for
            m/z 150.1", "open the Kendrick plot". It uses the same actions as the app's buttons.
          </DocLead>
          <DocP>
            It starts in <strong>Demo</strong> mode: offline keyword matching, no real AI. Choose OpenAI, Anthropic or a
            local Ollama model in the left panel to use a real model.
          </DocP>
        </>
      ),
    },
    {
      id: "providers",
      title: "Providers and API keys",
      keywords: ["openai", "anthropic", "claude", "ollama", "demo", "api key", "model"],
      body: (
        <>
          <DocUl>
            <DocLi>
              <strong>Demo</strong>: no network, no key; replies come from keyword matching, so "don't clear EICs" can
              still clear them.
            </DocLi>
            <DocLi>
              <strong>OpenAI / Anthropic</strong>: paste your API key. It is stored in this browser in plain text and
              sent straight from the browser to the provider.
            </DocLi>
            <DocLi>
              <strong>Ollama</strong>: a model running on your own computer; set its address (default{" "}
              <DocCode>http://127.0.0.1:11434</DocCode>) and a model you have pulled.
            </DocLi>
            <DocLi>
              <strong>Test</strong> checks the connection before you chat.
            </DocLi>
          </DocUl>
          <DocNote>Use a key with a low monthly spending limit, and don't use a shared browser profile.</DocNote>
        </>
      ),
    },
    {
      id: "context",
      title: "Context",
      keywords: ["sessions", "module", "context", "files"],
      body: (
        <DocUl>
          <DocLi>
            <strong>Include app context</strong> sends a short summary of your open files (names, counts, simple
            statistics) with each message, so answers refer to your data.
          </DocLi>
          <DocLi>
            <strong>Focus module</strong> narrows it to LCMS, FTIR or Plate Reader.
          </DocLi>
          <DocLi>
            Tick <strong>loaded sessions</strong> to narrow the context to those files; with none ticked, all loaded
            files are included. <strong>Refresh</strong> after opening new files.
          </DocLi>
        </DocUl>
      ),
    },
    {
      id: "actions",
      title: "Actions and approval",
      keywords: ["actions", "approve", "reject", "safe", "automation", "trace", "log"],
      body: (
        <DocUl>
          <DocLi>
            When the assistant wants to run an action you see it in the reply. Harmless actions (open a dialog, make an
            EIC) run on their own only if <strong>Auto-execute safe actions</strong> is on; anything else waits for{" "}
            <strong>Approve</strong> or <strong>Reject</strong>.
          </DocLi>
          <DocLi>
            <strong>Show tool-call trace</strong> lists each action with its inputs; the <strong>Action log</strong>{" "}
            keeps the history.
          </DocLi>
          <DocLi>
            <strong>Provider fallback</strong> tries the next configured provider if the chosen one fails.
          </DocLi>
        </DocUl>
      ),
    },
    {
      id: "starter-prompts",
      title: "Example questions, saved prompts and macros",
      keywords: ["prompts", "examples", "macros", "record", "replay"],
      body: (
        <DocUl>
          <DocLi>Clicking an example question on the empty chat sends it right away.</DocLi>
          <DocLi>
            <strong>Saved prompts</strong>: save the message you typed, then use it again (fills the box) or run it.
          </DocLi>
          <DocLi>
            <strong>Macros</strong>: Start recording, let the assistant run actions, then save them under a name and
            replay them later without the AI.
          </DocLi>
        </DocUl>
      ),
    },
    {
      id: "chat-column",
      title: "Chat",
      keywords: ["message", "export", "clear", "send"],
      body: (
        <DocP>
          Enter sends, Shift+Enter adds a line; the red button cancels a reply in progress. <strong>Export</strong> saves
          the chat as a text file; <strong>Clear chat</strong> removes the messages (your lab data is untouched).
        </DocP>
      ),
    },
    {
      id: "limitations",
      title: "Limitations",
      keywords: ["hallucination", "verify", "accuracy"],
      body: (
        <DocP>
          AI models can be confidently wrong. Check numbers against the charts, tables and calculation workbooks before
          you use them, and don't base conclusions on Demo mode replies.
        </DocP>
      ),
    },
  ],
};
