import type {
  DesktopAgentSettingsView,
  DesktopProjectMemoryStatusView,
} from '@electron-manager/agent-desktop-config/settings'

export function withProjectMemoryStatus(
  view: DesktopAgentSettingsView,
  projectMemory: DesktopProjectMemoryStatusView,
): DesktopAgentSettingsView {
  return { ...view, projectMemory }
}
