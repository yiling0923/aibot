// The shapes of a flow: a short conversation a merchant draws for one topic. Pure types, shared by the server, the bot and the control panel.

/** A text in each language. English is required; a missing language falls back to English. */
export type FlowText = Record<string, string>;

/** Where to go next. Missing (undefined or null): the block below. '__end': stop here. Otherwise the id of another block. */
export type FlowNext = string | null | undefined;

export type FlowBlock =
  | { id: string; type: 'message'; text: FlowText; next?: FlowNext }                              // the bot says this
  | { id: string; type: 'answer'; intent: string; next?: FlowNext }                               // the bot says a Knowledge base answer
  | { id: string; type: 'question'; text: FlowText; options: { id: string; label: FlowText; next?: FlowNext }[] }   // the bot asks, the customer taps one choice
  | { id: string; type: 'ask'; text: FlowText; field: string; next?: FlowNext }                   // the bot asks for a detail and keeps what the customer types (use {field} in later texts)
  | { id: string; type: 'handoff'; text: FlowText }                                               // a person takes over (the text is optional)
  | { id: string; type: 'end'; text: FlowText };                                                  // the flow is finished (the text is optional)

export type FlowBlockType = FlowBlock['type'];

export interface Flow {
  id: number; name: string; topic: string; status: 'live' | 'draft';
  blocks: FlowBlock[];                                   // the first block is where the flow starts
}

/** Where a customer is inside a flow. Saved with the chat session. */
export interface FlowState { flow: number; at: string; vars: Record<string, string>; misses: number }
