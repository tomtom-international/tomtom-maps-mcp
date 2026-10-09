# Code based on smolagents example from: https://github.com/huggingface/smolagents/blob/main/examples/agent_from_any_llm.py
import os
from mcp import StdioServerParameters
from smolagents import (
    CodeAgent,
    InferenceClientModel,
    OpenAIServerModel,
    TransformersModel,
    tool,
    ToolCollection,
    AzureOpenAIServerModel
)
from dotenv import load_dotenv
load_dotenv()

# Choose which inference type to use or add any other from the smolagents library!
available_inferences = ["inference_client", "transformers", "openai"]
chosen_inference = "inference_client"
#chosen_inference = "openai"

print(f"Chose model: '{chosen_inference}'")

if chosen_inference == "inference_client":
    model = InferenceClientModel(model_id="meta-llama/Llama-3.2-1B-Instruct", provider="auto")

elif chosen_inference == "openai":
    model = AzureOpenAIServerModel(model_id="your-deployment-id", azure_endpoint="your-azure-endpoint", api_key="your-azure-key", api_version="your-api-version")

elif chosen_inference == "transformers":
    model = TransformersModel(model_id="HuggingFaceTB/SmolLM2-1.7B-Instruct", device_map="auto", max_new_tokens=1000)

# Make sure there is an access token available
if os.environ.get("TOMTOM_API_KEY", None) is None:
    raise EnvironmentError("To use TomTom MCP you need to export `TOMTOM_API_KEY` environmental variable.")

# Run server with node
server_parameters = StdioServerParameters(
    command="npx",
    args=["-y", "@tomtom-org/tomtom-mcp@latest"],
    env={
        "TOMTOM_API_KEY": "<your_API_KEY>"}, # replace with your TomTom API key
)

# Connect to MCP, create agent with MCP's tool and run it
with ToolCollection.from_mcp(server_parameters, trust_remote_code=True) as tool_collection:
    print("check")
    for tool in tool_collection.tools:
        print(f"- {tool.name}")

    agent = CodeAgent(tools=tool_collection.tools, model=model, verbosity_level=2, stream_outputs=True)
    print("CodeAgent:", agent.run("How long does it take to drive from Amsterdam to Utrecht right now?")) # Try out different questions!