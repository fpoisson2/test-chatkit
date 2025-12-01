from agents import (
    ShellCallOutcome,
    ShellCommandOutput,
    ShellCommandRequest,
    ShellResult,
)

from .hosted_ssh import HostedSSH


class SSHShellExecutor:
    def __init__(self, ssh: HostedSSH):
        self.ssh = ssh

    async def __call__(self, request: ShellCommandRequest) -> ShellResult:
        action = request.data.action
        command = action.command

        # Execute command via HostedSSH
        # Note: HostedSSH.run_command currently returns combined output string
        # We might want to enhance HostedSSH to return structured data later
        # For now, we use what we have.
        output = await self.ssh.run_command(command)

        return ShellResult(
            output=[
                ShellCommandOutput(
                    command=command,
                    stdout=output,
                    stderr="", # HostedSSH combines stderr into stdout
                    outcome=ShellCallOutcome(type="exit", exit_code=0), # We assume success if no exception
                )
            ],
            max_output_length=action.max_output_length,
        )
