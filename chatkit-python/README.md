# ChatKit Python

ChatKit is a core library for the EDxo platform, facilitating the creation and management of AI agents and their interactions within the application. It provides the foundational components for handling chat sessions, agent registries, and integration with various LLM providers through OpenAI-compatible interfaces.

## Features

- **Agent Management**: Register and retrieve AI agents with different capabilities.
- **Context Management**: Handle conversation history and user context.
- **LLM Integration**: Seamless integration with OpenAI and other providers via `openai-agents` and `litellm`.
- **Server Utilities**: Tools for handling WebSocket connections and server-side chat logic.

## Installation

This library is intended to be used as a local dependency within the EDxo project.

```bash
pip install -e chatkit-python
```

## Usage

### Defining an Agent

Agents are the core of ChatKit. You can define an agent with specific instructions and tools.

```python
from chatkit import ChatKit
from chatkit.agents import Agent

agent = Agent(
    name="MyAssistant",
    instructions="You are a helpful assistant.",
    model="gpt-4"
)
```

### Server Integration

ChatKit integrates with the backend to handle real-time communication.

```python
from chatkit.server import ChatKitServer

# Initialize the server
server = ChatKitServer()

# Handle incoming messages
async def handle_message(message, context):
    response = await server.process_message(message, context)
    return response
```

## Contributing

Please refer to the main EDxo repository for contribution guidelines.

## License

This project is licensed under the [Apache License 2.0](LICENSE).
