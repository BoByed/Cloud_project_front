// ============================================================================
// Core Data Contract, Decimal Sequences & Error Types
// Based on HTTP API & WebSocket v1 Specification
// ============================================================================

export interface UserSummary {
  user_id: string;
  display_name: string;
}

export interface SessionInfo {
  user: UserSummary;
  session: {
    expires_at: string;
    idle_expires_at: string;
  };
  csrf_token: string;
}

export interface Room {
  room_id: string;
  kind: 'dm' | 'group';
  title: string;
  membership_role: 'owner' | 'admin' | 'member';
  last_seq: string;
}

export interface Message {
  message_id: string;
  room_id: string;
  seq: string;
  sender: UserSummary;
  client_message_id: string;
  text: string;
  image?: { url: string; content_type: string; byte_size: number; width: number; height: number };
  created_at: string;
}

export interface SendMessageResponse {
  message: Message;
  replayed: boolean;
}

export interface HistoryResponse {
  items: Message[];
  next_before_seq: string | null;
  has_more: boolean;
}

export interface SyncResponse {
  items: Message[];
  through_seq: string;
  next_after_seq: string;
  has_more: boolean;
}

export interface ApiErrorDetail {
  field: string;
  code: string;
}

export interface ApiErrorPayload {
  error: {
    code: string;
    message: string;
    request_id?: string;
    retryable: boolean;
    details?: ApiErrorDetail[];
  };
}

export type PendingStatus =
  | 'pending'
  | 'sending'
  | 'failed_retryable'
  | 'failed_permanent';

export interface PendingMessage {
  user_id: string;
  room_id: string;
  client_message_id: string;
  text: string;
  image?: File;
  created_at: string;
  status: PendingStatus;
  error_code?: string;
  error_message?: string;
  attempts: number;
}

export interface RoomCursorRecord {
  user_id: string;
  room_id: string;
  contiguous_seq: string;
  updated_at: string;
}

// WebSocket Message Schemas (subprotocol: "chat.v1")

export interface WsSubscribeMessage {
  type: 'subscribe';
  request_id: string;
  room_id: string;
}

export interface WsUnsubscribeMessage {
  type: 'unsubscribe';
  request_id: string;
  room_id: string;
}

export interface WsPingMessage {
  type: 'ping';
  request_id: string;
}

export type WsClientMessage =
  | WsSubscribeMessage
  | WsUnsubscribeMessage
  | WsPingMessage;

export interface WsSubscribedMessage {
  type: 'subscribed';
  request_id?: string;
  room_id: string;
  last_seq: string;
}

export interface WsUnsubscribedMessage {
  type: 'unsubscribed';
  request_id?: string;
  room_id: string;
}

export interface WsSubscriptionRevokedMessage {
  type: 'subscription.revoked';
  room_id: string;
  reason: string;
}

export interface WsPongMessage {
  type: 'pong';
  request_id: string;
}

export interface WsMessageCreatedMessage {
  type: 'message.created';
  room_id: string;
  message: Message;
}

export interface WsErrorMessage {
  type: 'error';
  request_id?: string;
  code: string;
  message: string;
}

export type WsServerMessage =
  | WsSubscribedMessage
  | WsUnsubscribedMessage
  | WsSubscriptionRevokedMessage
  | WsPongMessage
  | WsMessageCreatedMessage
  | WsErrorMessage;

// ============================================================================
// Sequence, Text & UUID Helpers
// ============================================================================

const SEQ_REGEX = /^(0|[1-9][0-9]*)$/;

/**
 * Validates and converts an unsigned decimal sequence string into a BigInt.
 * Enforces no negative numbers and no leading zeros (except single "0").
 */
export function parseSeq(seq: string): bigint {
  if (!SEQ_REGEX.test(seq)) {
    throw new Error(`Invalid sequence format: "${seq}". Must be unsigned decimal digits without leading zeros.`);
  }
  return BigInt(seq);
}

/**
 * Compares two sequence strings using BigInt comparison.
 * Returns -1 if a < b, 0 if a == b, 1 if a > b.
 */
export function compareSeq(a: string, b: string): number {
  const bigA = parseSeq(a);
  const bigB = parseSeq(b);
  if (bigA < bigB) return -1;
  if (bigA > bigB) return 1;
  return 0;
}

const textEncoder = new TextEncoder();

/**
 * Measures the exact UTF-8 byte length of a string.
 */
export function getUtf8ByteLength(text: string): number {
  return textEncoder.encode(text).byteLength;
}

/**
 * Validates message text according to Contract Section 3:
 * - Must not be empty or only whitespace (at least 1 non-whitespace char).
 * - Must not contain null bytes (\u0000).
 * - Must not exceed 4096 UTF-8 bytes.
 * - Does NOT trim or alter text silently.
 */
export function validateMessageText(text: string): {
  valid: boolean;
  reason?: string;
  byteLength: number;
} {
  const byteLength = getUtf8ByteLength(text);

  if (!/\S/.test(text)) {
    return {
      valid: false,
      reason: 'Message cannot be empty or contain only whitespace',
      byteLength
    };
  }

  if (text.includes('\u0000')) {
    return {
      valid: false,
      reason: 'Message cannot contain null bytes (\\u0000)',
      byteLength
    };
  }

  if (byteLength > 4096) {
    return {
      valid: false,
      reason: `Message exceeds 4096 UTF-8 bytes limit (${byteLength} bytes)`,
      byteLength
    };
  }

  return { valid: true, byteLength };
}

/**
 * Generates an RFC4122 v4 UUID with crypto.randomUUID or fallback.
 */
export function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for environments lacking crypto.randomUUID
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 10xx
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
