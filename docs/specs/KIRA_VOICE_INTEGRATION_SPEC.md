# KIRA — Voice Interaction + TTS Integration Specification

## Objetivo

Esta etapa adiciona **voz à Kira**, personagem/assistente desktop já existente.

O projeto atual **não deve ser reescrito**. Esta especificação é para integrar voz ao que já existe e preparar a transição de interação por texto para interação predominantemente por voz.

O comportamento-alvo é:

> Usuário: **"Kira, abre o Chrome."**

A Kira deve reconhecer o chamado, transcrever o comando, encaminhá-lo ao Agent Runtime existente e responder por voz.

Fluxo:

```text
Microfone
   │
   ▼
VAD / Speech Detection
   │
   ▼
Wake Word / Activation
   │
   │  "Kira"
   ▼
Speech-to-Text
   │
   │  "abre o Chrome"
   ▼
Agent Runtime
   │
   ▼
Tool: open_application("chrome")
   │
   ▼
Resultado
   │
   ├──────────────► Presentation State
   │
   └──────────────► TTS
                         │
                         ▼
                    OmniVoice
                         │
                         ▼
                       Áudio
                         │
                         ▼
                       Kira
```

---

# 1. Regra principal

Não criar um novo agente.

Não criar um segundo pipeline de execução.

A voz deve ser **uma nova interface de entrada/saída para o Agent Runtime existente**.

A arquitetura deve ficar:

```text
                    ┌─────────────────┐
                    │  INPUT CHANNELS │
                    └────────┬────────┘
                             │
                 ┌───────────┴───────────┐
                 ▼                       ▼
              TEXT                    VOICE
                 │                       │
                 │                  VAD + STT
                 │                       │
                 └───────────┬───────────┘
                             ▼
                     AGENT RUNTIME
                             │
                             ▼
                         TOOLS
                             │
                             ▼
                         RESULT
                             │
                 ┌───────────┴───────────┐
                 ▼                       ▼
              TEXT                    TTS
                                         │
                                         ▼
                                     OmniVoice
                                         │
                                         ▼
                                       Kira
```

O mesmo Agent Runtime deve processar texto digitado e comandos de voz.

---

# 2. Identidade da voz

A personagem se chama:

**Kira**

A voz deve ser tratada como parte da identidade da personagem.

Não espalhar configurações de voz pelo código.

Criar um `VoiceProfile`.

Exemplo:

```json
{
  "id": "kira",
  "provider": "omnivoice",
  "language": "pt-BR",
  "speed": 1.0,
  "pitch": 1.0,
  "style": "confident"
}
```

Os parâmetros exatos devem ser adaptados às capacidades da versão do OmniVoice instalada.

Não inventar parâmetros que o backend não suporta.

---

# 3. OmniVoice

O OmniVoice existente será utilizado como **TTS da Kira**.

Não instalar outro TTS apenas para esta etapa.

Não substituir OmniVoice por Piper, Kokoro ou outro mecanismo.

Criar uma abstração:

```typescript
interface TTSProvider {
    synthesize(
        text: string,
        profile: VoiceProfile
    ): Promise<AudioResult>;

    stop(): Promise<void>;
}
```

Implementar:

```text
OmniVoiceProvider
```

O Agent Runtime não deve importar diretamente módulos internos do OmniVoice.

Fluxo:

```text
Agent Runtime
      ↓
TTS Service
      ↓
TTSProvider
      ↓
OmniVoiceProvider
      ↓
OmniVoice
```

---

# 4. Voice Profile

Criar um perfil persistente para Kira.

Exemplo:

```json
{
  "id": "kira",
  "provider": "omnivoice",
  "language": "pt-BR",
  "referenceAudio": "voices/kira/reference.wav",
  "referenceText": "voices/kira/reference.txt",
  "speed": 1.0,
  "enabled": true
}
```

Se a instalação atual do OmniVoice utilizar voice design em vez de voice cloning, adaptar o profile para esse modo.

Não duplicar a referência de voz em vários locais.

---

# 5. Speech-to-Text

O TTS não resolve sozinho a entrada de voz.

Para:

> "Kira, abre o Chrome."

é necessário um componente de **STT**.

O STT deve ser separado do TTS.

Interface:

```typescript
interface STTProvider {
    start(): Promise<void>;
    stop(): Promise<void>;
    transcribe(audio: AudioBuffer): Promise<Transcript>;
}
```

O provider pode utilizar o mecanismo de ASR já disponível no ambiente OmniVoice, se essa instalação for o OmniVoice Studio, ou outro STT local compatível.

Não assumir que "OmniVoice TTS" significa automaticamente que o mesmo processo deve executar STT.

A implementação deve primeiro inspecionar o que já existe no projeto.

---

# 6. Voice Activity Detection

Não manter o STT processando continuamente frases completas sem necessidade.

Criar:

```text
Microphone
    ↓
VAD
    ↓
speech detected
    ↓
capture audio
    ↓
STT
```

O VAD deve determinar:

```text
SILENCE
SPEECH_STARTED
SPEECH_ACTIVE
SPEECH_ENDED
```

O objetivo é reduzir:

- uso de GPU;
- uso de CPU;
- latência;
- processamento de silêncio.

---

# 7. Ativação por nome

A ativação inicial deve funcionar com:

> **"Kira, abre o Chrome."**

O sistema deve identificar o nome de ativação:

```text
Kira
```

e remover esse prefixo antes de enviar o comando ao Agent Runtime.

Entrada:

```text
"Kira, abre o Chrome."
```

Comando encaminhado:

```text
"abre o Chrome"
```

A palavra "Kira" não deve ser enviada como parte desnecessária do conteúdo da tarefa.

---

# 8. Wake Word

Implementar inicialmente uma solução simples e robusta.

Existem dois modos possíveis:

### Modo A — STT contínuo + detecção textual

```text
Microfone
 ↓
VAD
 ↓
STT
 ↓
texto
 ↓
detectar "Kira"
```

É aceitável para o primeiro protótipo.

### Modo B — Wake-word dedicado

```text
Microfone
 ↓
Wake Word Engine
 ↓
"Kira" detectado
 ↓
captura comando
 ↓
STT
```

Este é o caminho de evolução.

Não introduzir um wake-word engine complexo antes de validar o fluxo básico.

---

# 9. Máquina de estados de voz

Criar estado independente para o pipeline de voz:

```text
VOICE_IDLE
    ↓
LISTENING_FOR_WAKE
    ↓
WAKE_DETECTED
    ↓
CAPTURING_COMMAND
    ↓
TRANSCRIBING
    ↓
COMMAND_READY
    ↓
FORWARDING
```

Estados de erro:

```text
STT_ERROR
AUDIO_ERROR
TIMEOUT
CANCELLED
```

---

# 10. Exemplo principal

Usuário:

> "Kira, abre o Chrome."

Pipeline:

```text
VOICE_IDLE
   ↓
LISTENING_FOR_WAKE
   ↓
"Kira" detectado
   ↓
CAPTURING_COMMAND
   ↓
"abre o Chrome"
   ↓
STT
   ↓
COMMAND_READY
   ↓
Agent Runtime
   ↓
open_application("chrome")
```

Se a ferramenta retornar sucesso:

```text
TOOL_SUCCESS
   ↓
Agent SUCCESS
   ↓
TTS
   ↓
"Pronto."
```

A Kira fala:

> "Pronto."

---

# 11. Não interpretar comandos de voz diretamente no módulo de voz

Não fazer:

```text
STT
 ↓
if "chrome" in text:
    open_chrome()
```

Isso é proibido arquiteturalmente.

O módulo de voz apenas produz:

```text
UserInput
```

Exemplo:

```json
{
  "source": "voice",
  "text": "abre o Chrome",
  "language": "pt-BR",
  "timestamp": "..."
}
```

O Agent Runtime decide o que fazer.

---

# 12. Mesmo caminho para texto e voz

Texto:

```text
User
 ↓
TextInput
 ↓
Agent Runtime
```

Voz:

```text
User
 ↓
VoiceInput
 ↓
STT
 ↓
TextInput
 ↓
Agent Runtime
```

A partir do Agent Runtime os dois caminhos são idênticos.

Isso é obrigatório.

---

# 13. TTS de resposta

Quando o Agent Runtime produzir uma resposta que deve ser falada:

```text
Agent Response
      ↓
Speech Decision
      ↓
TTS Service
      ↓
OmniVoice
      ↓
Audio Playback
```

Não transformar automaticamente toda mensagem interna em fala.

O sistema deve distinguir:

```text
internal event
tool status
user-facing response
```

Somente conteúdo destinado ao usuário deve ser falado.

---

# 14. Fala curta durante execução

A Kira poderá posteriormente emitir mensagens curtas:

> "Vou verificar."

> "Já estou abrindo."

> "Encontrei."

Mas isso deve ser controlado pelo Agent Runtime/Presentation Runtime.

Não fazer o módulo TTS narrar todas as ferramentas.

Evitar:

> "Agora estou chamando open_application."

> "Agora estou verificando o resultado."

---

# 15. Barge-in

Este é um requisito futuro importante.

Se Kira estiver falando:

> "Encontrei o resultado e..."

e o usuário disser:

> "Kira, para."

o sistema deve:

```text
USER SPEECH DETECTED
        ↓
STOP TTS
        ↓
INTERRUPT SPEECH
        ↓
PROCESS USER INPUT
```

Criar desde já uma interface:

```typescript
interface SpeechPlayback {
    play(audio: AudioBuffer): Promise<void>;
    stop(): Promise<void>;
    pause(): Promise<void>;
    resume(): Promise<void>;
}
```

Não é obrigatório implementar barge-in completo na primeira versão, mas a arquitetura deve permitir.

---

# 16. Estado visual da Kira

O Voice Runtime deve publicar eventos para o Avatar Overlay.

Exemplos:

```json
{
  "type": "voice.state.changed",
  "state": "LISTENING"
}
```

```json
{
  "type": "voice.state.changed",
  "state": "TRANSCRIBING"
}
```

```json
{
  "type": "speech.started"
}
```

```json
{
  "type": "speech.finished"
}
```

Mapeamento inicial:

```text
LISTENING
    → Kira attentive

TRANSCRIBING
    → Kira focused

SPEAKING
    → Kira speaking

SUCCESS
    → Kira happy

ERROR
    → Kira concerned
```

O Avatar não deve controlar o pipeline de voz.

---

# 17. Lip Sync

Preparar a integração:

```text
OmniVoice
   │
   ├── audio
   │
   └── timing/phoneme information, se disponível
             ↓
       LipSync Controller
             ↓
       Avatar Renderer
```

Primeira implementação pode utilizar amplitude de áudio:

```text
audio amplitude
      ↓
normalize 0..1
      ↓
mouth_open
```

Posteriormente substituir por fonemas/visemas se o pipeline fornecer informação temporal adequada.

---

# 18. Latência

Registrar:

```text
voice_capture_start
voice_capture_end
stt_start
stt_end
agent_start
agent_first_output
tts_start
tts_first_audio
tts_end
```

Calcular:

```text
speech_to_text_latency
agent_latency
time_to_first_audio
total_response_latency
```

O objetivo principal é reduzir:

**tempo entre o usuário terminar de falar e Kira começar a responder.**

---

# 19. Telemetria

Cada comando de voz deve possuir:

```text
session_id
turn_id
voice_input_id
timestamp
audio_duration
stt_provider
stt_latency
transcript
wake_detected
wake_confidence, se disponível
agent_latency
tool_count
tool_duration
tts_provider
tts_latency
total_latency
final_status
```

Evitar armazenar áudio bruto permanentemente por padrão.

Se houver gravação para debug, deve ser explicitamente configurável.

---

# 20. Segurança

O comando:

> "Kira, apague esse arquivo."

não deve ser executado diretamente pelo Voice Runtime.

Fluxo:

```text
Voice
 ↓
STT
 ↓
Agent Runtime
 ↓
Tool Request
 ↓
Policy
 ↓
Confirmation
 ↓
Execution
```

A voz não possui autoridade adicional.

---

# 21. Confirmação por voz

Posteriormente:

```text
Kira:
"Essa operação vai apagar o arquivo. Posso continuar?"

Usuário:
"Sim."

```

O sistema deverá tratar:

```text
"sim"
"pode"
"continue"
"pode fazer"
```

como respostas contextuais somente quando existir uma confirmação pendente.

Não interpretar "sim" globalmente como autorização.

---

# 22. Wake word durante fala

A palavra Kira pode aparecer naturalmente em uma resposta ou áudio externo.

Portanto, a detecção de wake word não deve disparar cegamente em qualquer ocorrência.

No futuro utilizar:

- VAD;
- wake-word dedicado;
- janela temporal;
- threshold;
- estado do agente.

Por exemplo:

```text
Kira está falando
    ↓
ignore wake detection
```

ou utilize barge-in explicitamente quando o usuário estiver falando.

---

# 23. Configuração

Criar configuração central:

```json
{
  "voice": {
    "enabled": true,
    "wakeWord": "kira",
    "language": "pt-BR",
    "ttsProvider": "omnivoice",
    "sttProvider": "local",
    "bargeIn": true
  }
}
```

Não espalhar:

```text
"kira"
"pt-BR"
"omnivoice"
```

pelo código.

---

# 24. Estrutura sugerida

Adaptar à estrutura existente. Não criar duplicação.

Conceitualmente:

```text
voice/
├── input/
│   ├── microphone
│   ├── vad
│   └── wakeword
│
├── stt/
│   ├── provider
│   └── service
│
├── tts/
│   ├── provider
│   ├── omnivoice
│   └── service
│
├── playback/
│
├── profiles/
│   └── kira
│
└── events/
```

Se o projeto já possui estrutura equivalente, preservar.

---

# 25. Primeira entrega

Não implementar tudo de uma vez.

A primeira entrega funcional deve ser:

```text
Microfone
   ↓
VAD
   ↓
STT
   ↓
detectar "Kira"
   ↓
extrair comando
   ↓
Agent Runtime existente
   ↓
open_application("chrome")
   ↓
resultado
   ↓
OmniVoice
   ↓
"Pronto."
```

Com o avatar mostrando:

```text
LISTENING
   ↓
THINKING
   ↓
EXECUTING
   ↓
SPEAKING
   ↓
IDLE
```

---

# 26. Caso de teste obrigatório

### TC-VOICE-001

Entrada:

> "Kira, abre o Chrome."

Esperado:

```text
1. Microfone detecta fala.
2. Sistema identifica "Kira".
3. "Kira" é removido do comando.
4. STT produz aproximadamente:
   "abre o Chrome"
5. Voice Runtime cria UserInput.
6. Agent Runtime recebe o UserInput.
7. Agent Runtime decide usar open_application.
8. Policy permite a ferramenta.
9. Chrome é aberto.
10. Resultado retorna SUCCESS.
11. Agent Runtime produz resposta final.
12. TTS utiliza o perfil Kira.
13. OmniVoice gera o áudio.
14. Avatar entra em SPEAKING.
15. Lip sync acompanha o áudio quando disponível.
16. Avatar retorna a IDLE.
17. Trace registra toda a execução.
```

---

# 27. Casos negativos obrigatórios

### TC-VOICE-002

Usuário:

> "Kira."

Esperado:

```text
wake detected
command missing
```

Kira deve aguardar o comando.

---

### TC-VOICE-003

Usuário:

> "Kira, abre o Chrome."

mas STT retorna:

> "Kira, abre o cromo."

O Agent Runtime deve lidar com a interpretação sem o Voice Runtime possuir lógica específica para Chrome.

---

### TC-VOICE-004

Usuário:

> "Kira, faça alguma coisa."

Esperado:

```text
AMBIGUOUS_REQUEST
```

Kira deve pedir esclarecimento.

---

### TC-VOICE-005

Usuário:

> "Kira, apague o arquivo X."

Esperado:

```text
Voice
 ↓
Agent
 ↓
Policy
 ↓
Confirmation required
```

Não executar automaticamente.

---

### TC-VOICE-006

Usuário fala durante a resposta da Kira.

Esperado:

```text
speech detected
 ↓
TTS interruption
```

se `bargeIn` estiver habilitado.

---

# 28. Critérios de aceite

A etapa será considerada concluída quando:

- [ ] Kira puder ser ativada por voz.
- [ ] "Kira, abre o Chrome" for reconhecido.
- [ ] o wake word não for enviado como parte desnecessária do comando.
- [ ] o comando for encaminhado ao Agent Runtime existente.
- [ ] a ferramenta existente puder abrir o Chrome.
- [ ] a resposta usar OmniVoice.
- [ ] a voz for a voz configurada de Kira.
- [ ] o avatar refletir LISTENING / THINKING / EXECUTING / SPEAKING.
- [ ] TTS puder ser interrompido.
- [ ] o sistema registrar latências.
- [ ] comandos de risco continuarem sujeitos ao Policy Engine.
- [ ] texto e voz utilizarem o mesmo Agent Runtime.
- [ ] nenhum código específico de "abrir Chrome" existir dentro do Voice Runtime.

---

# 29. Regra arquitetural final

A voz é apenas um canal.

```text
TEXT ─────────────┐
                  │
VOICE ────────────┼──► AGENT RUNTIME ──► TOOLS
                  │
FUTURE INPUT ─────┘
```

E a saída:

```text
                    AGENT RESULT
                         │
                ┌────────┴────────┐
                ▼                 ▼
              TEXT              TTS
                                  │
                                  ▼
                              OmniVoice
                                  │
                                  ▼
                                KIRA
```

**Não criar um "Voice Agent" separado.**

Existe um Agent Runtime único.

Kira apenas ganhou voz.

---

# 30. Referência técnica

O OmniVoice oficial suporta TTS local, voice cloning e voice design, com API Python e execução CUDA; a documentação atual também descreve controle por atributos de voz e geração rápida. Use a implementação já instalada no projeto em vez de introduzir outro TTS.

Se o projeto estiver utilizando **OmniVoice Studio**, ele também possui pipeline local de ASR e pode utilizar WhisperX/Faster-Whisper para transcrição, além de VAD/recursos de voz. Nesse caso, reutilizar o componente existente em vez de criar outro pipeline duplicado.

Fontes:
- https://github.com/k2-fsa/OmniVoice
- https://github.com/EmD-228/OmniVoice

---

# Instrução final para implementação

**Não reescreva o projeto.**

Primeiro:

1. audite o que já existe;
2. identifique o TTS/OmniVoice atualmente integrado;
3. identifique se já existe captura de microfone;
4. identifique se já existe STT/ASR;
5. identifique o Agent Runtime;
6. identifique o mecanismo atual de eventos;
7. identifique o Avatar Overlay.

Depois produza:

```text
EXISTENTE
   ↓
GAP
   ↓
ALTERAÇÃO MÍNIMA
```

Só então implemente.

O primeiro teste funcional obrigatório é:

> **"Kira, abre o Chrome."**

Resultado esperado:

> Chrome abre e Kira responde por voz.

Não criar uma arquitetura paralela para isso.
