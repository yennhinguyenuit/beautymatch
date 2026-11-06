$ErrorActionPreference = 'Stop'
function Invoke-CheckedDocker {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$DockerArguments)
    & docker @DockerArguments
    if ($LASTEXITCODE -ne 0) { throw 'Docker step failed. No subsequent step was run.' }
}
Invoke-CheckedDocker -DockerArguments @('start', 'crm-mariadb-1', 'crm-redis-1', 'crm-frappe-1')
Invoke-CheckedDocker -DockerArguments @('exec', 'crm-frappe-1', 'python', '/workspace/beautymatch/scripts/crm_native_patch.py', '--check')
Invoke-CheckedDocker -DockerArguments @('exec', 'crm-frappe-1', 'python', '/workspace/beautymatch/scripts/crm_native_patch.py', '--apply')
Invoke-CheckedDocker -DockerArguments @('exec', '-w', '/home/frappe/frappe-bench', 'crm-frappe-1', 'bench', '--site', 'crm.localhost', 'migrate')
Invoke-CheckedDocker -DockerArguments @('exec', '-w', '/home/frappe/frappe-bench', 'crm-frappe-1', 'bench', '--site', 'crm.localhost', 'execute', 'beautymatch.scripts.seed_demo.seed_demo')
Invoke-CheckedDocker -DockerArguments @('exec', '-w', '/home/frappe/frappe-bench', 'crm-frappe-1', 'bench', '--site', 'crm.localhost', 'execute', 'beautymatch.scripts.seed_demo.prepare_self_service')
Invoke-CheckedDocker -DockerArguments @('exec', '-w', '/home/frappe/frappe-bench/apps/crm/frontend', 'crm-frappe-1', 'yarn', 'build')
Invoke-CheckedDocker -DockerArguments @('exec', '-w', '/home/frappe/frappe-bench', 'crm-frappe-1', 'bench', 'build', '--app', 'beautymatch')
Invoke-CheckedDocker -DockerArguments @('exec', '-w', '/home/frappe/frappe-bench', 'crm-frappe-1', 'bench', '--site', 'crm.localhost', 'clear-cache')
Invoke-CheckedDocker -DockerArguments @('exec', '-w', '/home/frappe/frappe-bench', 'crm-frappe-1', 'bench', '--site', 'crm.localhost', 'clear-website-cache')
Invoke-CheckedDocker -DockerArguments @('restart', 'crm-frappe-1')
Write-Host 'Ready after the site finishes starting: http://localhost:8000/crm/beautymatch'
Write-Host 'Customer: http://localhost:8000/beautymatch/portal'
Write-Host 'Credentials: .local/seminar-credentials.json (never commit this file).'
