export type TerminalPanelVisibility = Record<string, boolean>;

export function createTerminalPanelVisibility(
  tabIds: string[]
): TerminalPanelVisibility {
  return syncTerminalPanelVisibility({}, tabIds);
}

export function syncTerminalPanelVisibility(
  visibility: TerminalPanelVisibility,
  tabIds: string[]
): TerminalPanelVisibility {
  return tabIds.reduce<TerminalPanelVisibility>((next, tabId) => {
    next[tabId] = visibility[tabId] ?? true;
    return next;
  }, {});
}

export function setTerminalPanelOpen(
  visibility: TerminalPanelVisibility,
  tabId: string,
  isOpen: boolean
): TerminalPanelVisibility {
  return {
    ...visibility,
    [tabId]: isOpen,
  };
}

export function isTerminalPanelOpen(
  visibility: TerminalPanelVisibility,
  tabId: string
): boolean {
  return visibility[tabId] ?? true;
}
