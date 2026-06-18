import { Header } from "@/components/Header";
import { Composer } from "@/components/Composer";
import { Conversation } from "@/components/Conversation";
import { useFilingQueue } from "@/hooks/useFilingQueue";
import { useSpeechCapture } from "@/hooks/useSpeechCapture";

export default function App() {
  const { messages, status, error, enqueue, queued } = useFilingQueue();
  const capture = useSpeechCapture(enqueue);

  return (
    <div className="flex h-full flex-col">
      <Header status={status} error={error} />
      <Conversation
        messages={messages}
        status={status}
        queued={queued}
        interim={capture.recording ? capture.interim : ""}
      />
      <Composer capture={capture} />
    </div>
  );
}
