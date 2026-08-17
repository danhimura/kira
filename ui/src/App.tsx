import "./App.css";
import { Avatar } from "./components/Avatar";
import { StatusPanel } from "./components/StatusPanel";
import { ChatInput } from "./components/ChatInput";
import { useAymiAgent } from "./ws/useAymiAgent";

function App() {
  const {
    connected,
    presentationState,
    animation,
    messages,
    toolActivity,
    pendingConfirmation,
    errorMessage,
    processing,
    sendInput,
    sendConfirm,
    sendCancel,
  } = useAymiAgent();

  return (
    <div className="app">
      <header className="app-header">aymi</header>
      <main className="app-body">
        <div className="avatar-pane">
          <Avatar expression={animation.expression} mouthOpenness={animation.mouthOpenness} blinking={animation.blinking} />
        </div>
        <div className="status-pane">
          <StatusPanel
            connected={connected}
            presentationState={presentationState}
            messages={messages}
            toolActivity={toolActivity}
            pendingConfirmation={pendingConfirmation}
            errorMessage={errorMessage}
            onConfirm={sendConfirm}
          />
        </div>
      </main>
      <ChatInput processing={processing} onSend={sendInput} onCancel={sendCancel} />
    </div>
  );
}

export default App;
