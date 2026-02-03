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
        outputs: list[ShellCommandOutput] = []

        for command in action.commands:
            result = await self.ssh.run_command_with_context(command)

            username = self.ssh.config.username
            hostname = self.ssh.config.host
            prompt_cwd = result.cwd or "~"
            prompt_symbol = "#" if username == "root" else "$"
            outputs.append(
                ShellCommandOutput(
                    command=command,
                    user=username,
                    host=hostname,
                    hostname=hostname,
                    cwd=result.cwd,
                    prompt=f"{username}@{hostname}:{prompt_cwd}{prompt_symbol}",
                    stdout=result.stdout,
                    stderr=result.stderr,
                    outcome=ShellCallOutcome(type="exit", exit_code=result.exit_status),
                )
            )

        return ShellResult(output=outputs, max_output_length=action.max_output_length)
