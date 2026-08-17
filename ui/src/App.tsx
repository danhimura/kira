import "./App.css";
import { Avatar } from "./components/Avatar";
import { StatusPanel } from "./components/StatusPanel";
import { ChatInput } from "./components/ChatInput";
import { OverlaySettingsPanel } from "./components/OverlaySettingsPanel";
import { useAymiAgent } from "./ws/useAymiAgent";
import { useOverlay } from "./overlay/useOverlay";

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

  const overlay = useOverlay();
  // Outside Tauri (plain browser tab, e.g. verification via the Browser
  // pane), click-through/transparency don't apply - always show the full
  // chat UI there, same as before this change.
  const showFullUi = overlay.configMode || !overlay.available;

  return (
    <div className={`app ${showFullUi ? "app--config" : "app--overlay"}`}>
      {showFullUi && (
        <header className="app-header" onMouseDown={() => overlay.startDragging()}>
          aymi
        </header>
      )}
      <main className="app-body">
        <div className="avatar-pane">
          <Avatar expression={animation.expression} mouthOpenness={animation.mouthOpenness} blinking={animation.blinking} />
        </div>
        {showFullUi && (
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
        )}
      </main>
      {showFullUi && overlay.available && <OverlaySettingsPanel overlay={overlay} />}
      {showFullUi && <ChatInput processing={processing} onSend={sendInput} onCancel={sendCancel} />}
    </div>
  );
}

export default App;
