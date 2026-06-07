import { Header } from "@/components/Header";
import { Composer } from "@/components/Composer";
import { CaptureFeed } from "@/components/CaptureFeed";
import { useFeed } from "@/hooks/useFeed";
import { useSpeechCapture } from "@/hooks/useSpeechCapture";

export default function App() {
  const { captures, model, ready, connected } = useFeed();
  const capture = useSpeechCapture();

  return (
    <div className="flex h-full flex-col">
      <Header model={model} ready={ready} connected={connected} />
      <CaptureFeed captures={captures} interim={capture.recording ? capture.interim : ""} />
      <Composer capture={capture} />
    </div>
  );
}
