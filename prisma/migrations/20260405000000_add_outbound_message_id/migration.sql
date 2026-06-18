-- Our own RFC 5322 Message-ID per outbound email, used to thread follow-ups via
-- In-Reply-To / References. SendGrid's sgMessageId (x-message-id) is an internal
-- id, not the RFC Message-ID, so we generate and control our own.
ALTER TABLE "outbound_messages" ADD COLUMN "messageId" TEXT;
CREATE UNIQUE INDEX "outbound_messages_messageId_key" ON "outbound_messages"("messageId");
