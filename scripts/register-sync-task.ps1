<#
.SYNOPSIS
  Register the Golden Retrievers current-season refresh as a Windows scheduled
  task.

.DESCRIPTION
  The task runs scripts/sync-current.mjs, which fetches whatever the live league
  has published since the last run, regenerates the site data, proves nothing
  was lost, and writes a run record. It NEVER pushes and NEVER commits to the
  default branch. With -Commit it puts the result on a dated branch for a person
  to review.

  DAILY, ON THE CAPTAIN'S OWN ACCOUNT OF THE SCHEDULE. He plays Monday through
  Friday and the league posts scores the morning after, so a game and its result
  are a day apart at most — and anything less frequent than daily means a result
  sits unpublished while the next one is already played. This was twice a week
  and that was reasoned from the wrong fixture list.

  09:30 rather than dawn, for the same reason: a job that runs before the
  scorekeeper has typed anything finds nothing and then waits a day. The
  morning-after window is what it is aiming at.

  DAILY IS CHEAP AND THAT IS NOT AN ACCIDENT. sync-current.mjs diffs before it
  fetches: a run with nothing new makes ZERO network requests and exits in
  seconds, so six of seven runs a week cost nothing at all. The 12-hour
  freshness window in that script is what lets consecutive daily runs still see
  a live page rather than a cached one.

.EXAMPLE
  npm run sync:install-task
  npm run sync:install-task -- -Commit -At 09:30
  npm run sync:install-task -- -DaysOfWeek Tuesday,Friday -At 05:30   # the old cadence
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$TaskName = "Golden Retrievers current-season refresh",
  # Empty means DAILY, which is the default. Naming days narrows it to those
  # days, which is what the old twice-a-week cadence was.
  [ValidateSet("Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday")]
  [string[]]$DaysOfWeek = @(),
  [datetime]$At = "09:30",
  # Hours after which a live URL is considered stale and re-fetched. The
  # corpus-wide default is a week, which is right for archived sources and
  # wrong for a season being played.
  [int]$FreshnessHours = 12,
  # Put the refreshed result on a dated branch for review. Still never pushes.
  [switch]$Commit,
  [switch]$WithSiteBuild,
  [switch]$RunWhetherLoggedOn
)

$ErrorActionPreference = "Stop"

$workspace = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source

$flags = @("--freshness-hours=$FreshnessHours")
if ($Commit) { $flags += "--commit" }
if ($WithSiteBuild) { $flags += "--build-site" }
$arguments = "run sync:current -- " + ($flags -join " ")

$action = New-ScheduledTaskAction `
  -Execute $npm `
  -Argument $arguments `
  -WorkingDirectory $workspace
# Daily unless days were named. -Daily and -Weekly are different trigger kinds,
# not the same trigger with a different filter, so this is a branch rather than
# a parameter.
$trigger = if ($DaysOfWeek.Count -gt 0) {
  New-ScheduledTaskTrigger -Weekly -DaysOfWeek $DaysOfWeek -At $At
} else {
  New-ScheduledTaskTrigger -Daily -At $At
}
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2)
$description = "Captures current Golden Retrievers results, verifies nothing was lost, and reports what changed. Never pushes."

$when = if ($DaysOfWeek.Count -gt 0) {
  "$($DaysOfWeek -join ', ') at $($At.ToString('HH:mm'))"
} else {
  "every day at $($At.ToString('HH:mm'))"
}
if (-not $PSCmdlet.ShouldProcess($TaskName, "Register task for $when")) {
  return
}

if ($RunWhetherLoggedOn) {
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  $credential = Get-Credential -UserName $identity -Message "Windows credentials for the scheduled network capture"
  Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description $description `
    -User $credential.UserName `
    -Password $credential.GetNetworkCredential().Password `
    -Force | Out-Null
} else {
  Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description $description `
    -Force | Out-Null
}

Write-Host "Registered '$TaskName' for $when."
Write-Host "Workspace: $workspace"
Write-Host "Command:   $npm $arguments"
Write-Host ""
Write-Host "The task never pushes and never commits to the default branch."
Write-Host "Review what it produces with: git log --oneline data/refresh-*"
