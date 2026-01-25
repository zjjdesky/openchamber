/* eslint-disable react-refresh/only-export-components */
import React from 'react';
import type { Message, Part } from '@opencode-ai/sdk/v2';
import type { TurnGroupingContext as TurnGroupingContextType } from '../hooks/useTurnGrouping';
import { detectTurns, type Turn, type TurnActivityPart, type TurnActivityGroup } from '../hooks/useTurnGrouping';
import { useCurrentSessionActivity } from '@/hooks/useSessionActivity';
import { useUIStore } from '@/stores/useUIStore';

interface ChatMessageEntry {
    info: Message;
    parts: Part[];
}

interface TurnDiffStats {
    additions: number;
    deletions: number;
    files: number;
}

interface TurnActivityInfo {
    activityParts: TurnActivityPart[];
    activityGroupSegments: TurnActivityGroup[];
    hasTools: boolean;
    hasReasoning: boolean;
    summaryBody?: string;
    diffStats?: TurnDiffStats;
}

interface NeighborInfo {
    previousMessage?: ChatMessageEntry;
    nextMessage?: ChatMessageEntry;
}

// Static data that only changes when messages change
interface TurnGroupingStaticData {
    turns: Turn[];
    messageToTurn: Map<string, Turn>;
    turnActivityInfo: Map<string, TurnActivityInfo>;
    lastTurnId: string | null;
    lastTurnMessageIds: Set<string>; // Messages belonging to the last turn
    defaultActivityExpanded: boolean;
    // Neighbor lookup - stable until messages change
    messageNeighbors: Map<string, NeighborInfo>;
}

// Dynamic data that changes during streaming
interface TurnGroupingDynamicData {
    sessionIsWorking: boolean;
    turnUiStates: Map<string, { isExpanded: boolean }>;
    toggleGroup: (turnId: string) => void;
}

// Separate contexts to prevent unnecessary re-renders
const TurnGroupingStaticContext = React.createContext<TurnGroupingStaticData | null>(null);
const TurnGroupingDynamicContext = React.createContext<TurnGroupingDynamicData | null>(null);

// Track staticData reference to clear cache when it changes
let lastStaticDataRef: TurnGroupingStaticData | null = null;
const contextCache = new Map<string, TurnGroupingContextType>();

export const useTurnGroupingContextForMessage = (messageId: string): TurnGroupingContextType | undefined => {
    const staticData = React.useContext(TurnGroupingStaticContext);
    const dynamicData = React.useContext(TurnGroupingDynamicContext);
    
    return React.useMemo(() => {
        if (!staticData || !dynamicData) return undefined;
        
        // Clear cache when staticData changes (new messages arrived)
        if (lastStaticDataRef !== staticData) {
            contextCache.clear();
            lastStaticDataRef = staticData;
        }
        
        const turn = staticData.messageToTurn.get(messageId);
        if (!turn) return undefined;
        
        const isAssistantMessage = turn.assistantMessages.some(
            (msg) => msg.info.id === messageId
        );
        if (!isAssistantMessage) return undefined;
        
        // Only include sessionIsWorking in cache key for the LAST turn
        // Other turns don't need to re-render when streaming state changes
        const isLastTurn = staticData.lastTurnId === turn.turnId;
        const cacheKey = isLastTurn 
            ? `${messageId}-${staticData.lastTurnId}-${dynamicData.sessionIsWorking}`
            : `${messageId}-static`;
        
        const cached = contextCache.get(cacheKey);
        if (cached) return cached;
        
        const activityInfo = staticData.turnActivityInfo.get(turn.turnId);
        const activityParts = activityInfo?.activityParts ?? [];
        const activityGroupSegments = activityInfo?.activityGroupSegments ?? [];
        const hasTools = Boolean(activityInfo?.hasTools);
        const hasReasoning = Boolean(activityInfo?.hasReasoning);
        const summaryBody = activityInfo?.summaryBody;
        const diffStats = activityInfo?.diffStats;
        
        const firstAssistantId = turn.assistantMessages[0]?.info.id;
        const isFirstAssistantInTurn = messageId === firstAssistantId;
        const lastAssistantId = turn.assistantMessages[turn.assistantMessages.length - 1]?.info.id;
        const isLastAssistantInTurn = messageId === lastAssistantId;
        const headerMessageId = firstAssistantId;
        
        const uiState = dynamicData.turnUiStates.get(turn.turnId) ?? { isExpanded: staticData.defaultActivityExpanded };
        // Only the last turn can be "working"
        const isTurnWorking = isLastTurn && dynamicData.sessionIsWorking;
        
        const userTimeInfo = turn.userMessage.info.time as { created?: number } | undefined;
        const userMessageCreatedAt = typeof userTimeInfo?.created === 'number' ? userTimeInfo.created : undefined;
        
        const context: TurnGroupingContextType = {
            turnId: turn.turnId,
            isFirstAssistantInTurn,
            isLastAssistantInTurn,
            summaryBody,
            activityParts,
            activityGroupSegments,
            headerMessageId,
            hasTools,
            hasReasoning,
            diffStats,
            userMessageCreatedAt,
            isWorking: isTurnWorking,
            isGroupExpanded: uiState.isExpanded,
            toggleGroup: () => dynamicData.toggleGroup(turn.turnId),
        };
        
        // Cache with size limit
        if (contextCache.size > 500) {
            const firstKey = contextCache.keys().next().value;
            if (firstKey) contextCache.delete(firstKey);
        }
        contextCache.set(cacheKey, context);
        
        return context;
    }, [staticData, dynamicData, messageId]);
};

// Hook to get neighbor messages - uses context instead of passed messages array
export const useMessageNeighbors = (messageId: string): NeighborInfo => {
    const staticData = React.useContext(TurnGroupingStaticContext);
    
    // Return stable reference from context - no dependencies on messages array
    return React.useMemo(() => {
        if (!staticData) return {};
        return staticData.messageNeighbors.get(messageId) ?? {};
    }, [staticData, messageId]);
};

// Hook to get last turn message IDs - only reads static context
export const useLastTurnMessageIds = (): Set<string> => {
    const staticData = React.useContext(TurnGroupingStaticContext);
    return staticData?.lastTurnMessageIds ?? new Set();
};

// Static-only version of turn grouping context - does NOT subscribe to dynamic context
// Use this for messages NOT in the last turn to avoid re-renders during streaming
export const useTurnGroupingContextStatic = (messageId: string): TurnGroupingContextType | undefined => {
    const staticData = React.useContext(TurnGroupingStaticContext);
    
    return React.useMemo(() => {
        if (!staticData) return undefined;
        
        const turn = staticData.messageToTurn.get(messageId);
        if (!turn) return undefined;
        
        const isAssistantMessage = turn.assistantMessages.some(
            (msg) => msg.info.id === messageId
        );
        if (!isAssistantMessage) return undefined;
        
        const activityInfo = staticData.turnActivityInfo.get(turn.turnId);
        const activityParts = activityInfo?.activityParts ?? [];
        const activityGroupSegments = activityInfo?.activityGroupSegments ?? [];
        const hasTools = Boolean(activityInfo?.hasTools);
        const hasReasoning = Boolean(activityInfo?.hasReasoning);
        const summaryBody = activityInfo?.summaryBody;
        const diffStats = activityInfo?.diffStats;
        
        const firstAssistantId = turn.assistantMessages[0]?.info.id;
        const isFirstAssistantInTurn = messageId === firstAssistantId;
        const lastAssistantId = turn.assistantMessages[turn.assistantMessages.length - 1]?.info.id;
        const isLastAssistantInTurn = messageId === lastAssistantId;
        const headerMessageId = firstAssistantId;
        
        const userTimeInfo = turn.userMessage.info.time as { created?: number } | undefined;
        const userMessageCreatedAt = typeof userTimeInfo?.created === 'number' ? userTimeInfo.created : undefined;
        
        // For static context, isWorking is always false and isGroupExpanded uses default
        const context: TurnGroupingContextType = {
            turnId: turn.turnId,
            isFirstAssistantInTurn,
            isLastAssistantInTurn,
            summaryBody,
            activityParts,
            activityGroupSegments,
            headerMessageId,
            hasTools,
            hasReasoning,
            diffStats,
            userMessageCreatedAt,
            isWorking: false, // Static context - turn is completed
            isGroupExpanded: staticData.defaultActivityExpanded,
            toggleGroup: () => {}, // No-op for static - will be overridden if needed
        };
        
        return context;
    }, [staticData, messageId]);
};

interface TurnGroupingProviderProps {
    messages: ChatMessageEntry[];
    children: React.ReactNode;
}

const ACTIVITY_STANDALONE_TOOL_NAMES = new Set<string>(['task']);

const isActivityStandaloneTool = (toolName: unknown): boolean => {
    return typeof toolName === 'string' && ACTIVITY_STANDALONE_TOOL_NAMES.has(toolName.toLowerCase());
};

const ENABLE_TEXT_JUSTIFICATION_ACTIVITY = false;

const extractFinalAssistantText = (turn: Turn): string | undefined => {
    for (const assistantMsg of turn.assistantMessages) {
        const infoFinish = (assistantMsg.info as { finish?: string | null | undefined }).finish;
        if (infoFinish === 'stop') {
            const textPart = assistantMsg.parts.find(p => p.type === 'text');
            if (textPart) {
                const textContent = (textPart as { text?: string | null | undefined }).text ??
                                  (textPart as { content?: string | null | undefined }).content;
                if (typeof textContent === 'string' && textContent.trim().length > 0) {
                    return textContent;
                }
            }
        }
    }
    return undefined;
};

const getTurnActivityInfo = (turn: Turn): TurnActivityInfo => {
    interface SummaryDiff {
        additions?: number | null | undefined;
        deletions?: number | null | undefined;
        file?: string | null | undefined;
    }
    interface UserSummaryPayload {
        body?: string | null | undefined;
        diffs?: SummaryDiff[] | null | undefined;
    }

    const summaryBody = extractFinalAssistantText(turn);

    let diffStats: TurnDiffStats | undefined;

    const summary = (turn.userMessage.info as { summary?: UserSummaryPayload | null | undefined }).summary;
    const diffs = summary?.diffs;
    if (Array.isArray(diffs) && diffs.length > 0) {
        let additions = 0;
        let deletions = 0;
        let files = 0;

        diffs.forEach((diff) => {
            if (!diff) return;
            const diffAdditions = typeof diff.additions === 'number' ? diff.additions : 0;
            const diffDeletions = typeof diff.deletions === 'number' ? diff.deletions : 0;
            if (diffAdditions !== 0 || diffDeletions !== 0) {
                files += 1;
            }
            additions += diffAdditions;
            deletions += diffDeletions;
        });

        if (files > 0) {
            diffStats = { additions, deletions, files };
        }
    }

    let hasTools = false;
    let hasReasoning = false;

    turn.assistantMessages.forEach((msg) => {
        msg.parts.forEach((part) => {
            if (part.type === 'tool') hasTools = true;
            else if (part.type === 'reasoning') hasReasoning = true;
        });
    });

    const activityParts: TurnActivityPart[] = [];
    let syntheticIdCounter = 0;

    turn.assistantMessages.forEach((msg) => {
        const messageId = msg.info.id;
        const infoFinish = (msg.info as { finish?: string | null | undefined }).finish;
        const hasStopFinishInMessage = ENABLE_TEXT_JUSTIFICATION_ACTIVITY ? infoFinish === 'stop' : false;

        msg.parts.forEach((part) => {
            const baseId = (typeof part.id === 'string' && part.id.trim().length > 0)
                ? part.id
                : `${messageId}-activity-${syntheticIdCounter++}`;

            if (part.type === 'tool') {
                const state = (part as { state?: { time?: { end?: number | null | undefined } | null | undefined } | null | undefined }).state;
                const time = state?.time;
                const end = typeof time?.end === 'number' ? time.end : undefined;

                activityParts.push({
                    id: baseId,
                    turnId: turn.turnId,
                    messageId,
                    kind: 'tool',
                    part,
                    endedAt: end,
                });
                return;
            }

            if (part.type === 'reasoning') {
                const text = (part as { text?: string | null | undefined; content?: string | null | undefined }).text
                    ?? (part as { text?: string | null | undefined; content?: string | null | undefined }).content;
                if (typeof text !== 'string' || text.trim().length === 0) return;
                const time = (part as { time?: { end?: number | null | undefined } | null | undefined }).time;
                const end = typeof time?.end === 'number' ? time.end : undefined;

                activityParts.push({
                    id: baseId,
                    turnId: turn.turnId,
                    messageId,
                    kind: 'reasoning',
                    part,
                    endedAt: end,
                });
                return;
            }

            if (
                ENABLE_TEXT_JUSTIFICATION_ACTIVITY &&
                part.type === 'text' &&
                (hasTools || hasReasoning) &&
                !hasStopFinishInMessage
            ) {
                const text = (part as { text?: string | null | undefined; content?: string | null | undefined }).text ??
                    (part as { text?: string | null | undefined; content?: string | null | undefined }).content;
                if (typeof text !== 'string' || text.trim().length === 0) return;
                const time = (part as { time?: { end?: number | null | undefined } | null | undefined }).time;
                const end = typeof time?.end === 'number' ? time.end : undefined;

                activityParts.push({
                    id: baseId,
                    turnId: turn.turnId,
                    messageId,
                    kind: 'justification',
                    part,
                    endedAt: end,
                });
            }
        });
    });

    const activityGroupSegments: TurnActivityGroup[] = [];
    const activityByPart = new WeakMap<Part, TurnActivityPart>();
    activityParts.forEach((activity) => {
        activityByPart.set(activity.part, activity);
    });

    const taskMessageById = new Map<string, string>();
    const taskOrder: string[] = [];
    const partsByAfterTool = new Map<string | null, TurnActivityPart[]>();
    let currentAfterToolPartId: string | null = null;

    turn.assistantMessages.forEach((msg) => {
        const messageId = msg.info.id;

        msg.parts.forEach((part) => {
            if (part.type === 'tool') {
                const toolName = (part as { tool?: unknown }).tool;
                if (isActivityStandaloneTool(toolName)) {
                    const toolPartId = typeof part.id === 'string' && part.id.trim().length > 0
                        ? part.id
                        : `${messageId}-task-${taskOrder.length + 1}`;

                    if (!taskMessageById.has(toolPartId)) {
                        taskMessageById.set(toolPartId, messageId);
                        taskOrder.push(toolPartId);
                    }
                    currentAfterToolPartId = toolPartId;
                    return;
                }
            }

            const activity = activityByPart.get(part);
            if (!activity) return;

            if (activity.kind === 'tool') {
                const toolName = (activity.part as { tool?: unknown }).tool;
                if (isActivityStandaloneTool(toolName)) return;
            }

            const list = partsByAfterTool.get(currentAfterToolPartId) ?? [];
            list.push(activity);
            partsByAfterTool.set(currentAfterToolPartId, list);
        });
    });

    const pickAnchorForStartSegment = (segmentParts: TurnActivityPart[]): string | undefined => {
        if (segmentParts.length === 0) return undefined;

        const countByMessage = new Map<string, number>();
        segmentParts.forEach((activity) => {
            countByMessage.set(activity.messageId, (countByMessage.get(activity.messageId) ?? 0) + 1);
        });

        let firstWithAny: string | undefined;
        let cumulative = 0;
        for (const msg of turn.assistantMessages) {
            const count = countByMessage.get(msg.info.id) ?? 0;
            if (count > 0 && !firstWithAny) firstWithAny = msg.info.id;
            cumulative += count;
            if (cumulative >= 2) return msg.info.id;
        }
        return firstWithAny;
    };

    const orderedKeys: Array<string | null> = [null, ...taskOrder];

    orderedKeys.forEach((afterToolPartId) => {
        const segmentParts = partsByAfterTool.get(afterToolPartId) ?? [];
        if (segmentParts.length === 0) return;

        const anchorMessageId = afterToolPartId === null
            ? pickAnchorForStartSegment(segmentParts)
            : taskMessageById.get(afterToolPartId);

        if (!anchorMessageId) return;

        activityGroupSegments.push({
            id: `${turn.turnId}:${anchorMessageId}:${afterToolPartId ?? 'start'}`,
            anchorMessageId,
            afterToolPartId,
            parts: segmentParts,
        });
    });

    return {
        activityParts,
        activityGroupSegments,
        hasTools,
        hasReasoning,
        summaryBody,
        diffStats,
    };
};

// Build neighbor lookup map from messages
const buildNeighborMap = (messages: ChatMessageEntry[]): Map<string, NeighborInfo> => {
    const map = new Map<string, NeighborInfo>();
    messages.forEach((message, index) => {
        map.set(message.info.id, {
            previousMessage: index > 0 ? messages[index - 1] : undefined,
            nextMessage: index < messages.length - 1 ? messages[index + 1] : undefined,
        });
    });
    return map;
};

export const TurnGroupingProvider: React.FC<TurnGroupingProviderProps> = ({ messages, children }) => {
    const { isWorking: sessionIsWorking } = useCurrentSessionActivity();
    const toolCallExpansion = useUIStore((state) => state.toolCallExpansion);
    const defaultActivityExpanded = toolCallExpansion === 'activity' || toolCallExpansion === 'detailed';

    // Static data - only changes when messages change
    const staticValue = React.useMemo<TurnGroupingStaticData>(() => {
        const turns = detectTurns(messages);
        const lastTurnId = turns.length > 0 ? turns[turns.length - 1]!.turnId : null;
        
        const messageToTurn = new Map<string, Turn>();
        turns.forEach((turn) => {
            messageToTurn.set(turn.userMessage.info.id, turn);
            turn.assistantMessages.forEach((msg) => {
                messageToTurn.set(msg.info.id, turn);
            });
        });

        const turnActivityInfo = new Map<string, TurnActivityInfo>();
        turns.forEach((turn) => {
            turnActivityInfo.set(turn.turnId, getTurnActivityInfo(turn));
        });

        const messageNeighbors = buildNeighborMap(messages);

        // Build set of message IDs belonging to the last turn
        const lastTurnMessageIds = new Set<string>();
        if (turns.length > 0) {
            const lastTurn = turns[turns.length - 1]!;
            lastTurnMessageIds.add(lastTurn.userMessage.info.id);
            lastTurn.assistantMessages.forEach((msg) => {
                lastTurnMessageIds.add(msg.info.id);
            });
        }

        return {
            turns,
            messageToTurn,
            turnActivityInfo,
            lastTurnId,
            lastTurnMessageIds,
            defaultActivityExpanded,
            messageNeighbors,
        };
    }, [messages, defaultActivityExpanded]);

    // UI state for expansion toggles
    const [turnUiStates, setTurnUiStates] = React.useState<Map<string, { isExpanded: boolean }>>(
        () => new Map()
    );

    // Reset turn UI states when expansion preference changes
    React.useEffect(() => {
        setTurnUiStates(new Map());
    }, [toolCallExpansion]);

    const toggleGroup = React.useCallback((turnId: string) => {
        setTurnUiStates((prev) => {
            const next = new Map(prev);
            const current = next.get(turnId) ?? { isExpanded: defaultActivityExpanded };
            next.set(turnId, { isExpanded: !current.isExpanded });
            return next;
        });
    }, [defaultActivityExpanded]);

    // Dynamic data - changes during streaming and UI interactions
    const dynamicValue = React.useMemo<TurnGroupingDynamicData>(() => ({
        sessionIsWorking,
        turnUiStates,
        toggleGroup,
    }), [sessionIsWorking, turnUiStates, toggleGroup]);

    return (
        <TurnGroupingStaticContext.Provider value={staticValue}>
            <TurnGroupingDynamicContext.Provider value={dynamicValue}>
                {children}
            </TurnGroupingDynamicContext.Provider>
        </TurnGroupingStaticContext.Provider>
    );
};

// Clear context cache on unmount or session change
export const clearTurnGroupingCache = (): void => {
    contextCache.clear();
};
