import assert from 'node:assert/strict'
import test from 'node:test'
import { FileTextIcon, XIcon } from 'lucide-react'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from './attachment'

test('renders a composed attachment with stable slots', () => {
  const markup = renderToStaticMarkup(
    <AttachmentGroup aria-label="Selected files">
      <Attachment state="done" size="sm">
        <AttachmentMedia>
          <FileTextIcon />
        </AttachmentMedia>
        <AttachmentContent>
          <AttachmentTitle>notes.md</AttachmentTitle>
          <AttachmentDescription>Markdown · 2 KB</AttachmentDescription>
        </AttachmentContent>
        <AttachmentActions>
          <AttachmentAction aria-label="Remove notes.md">
            <XIcon />
          </AttachmentAction>
        </AttachmentActions>
      </Attachment>
    </AttachmentGroup>,
  )

  assert.match(markup, /data-slot="attachment-group"/)
  assert.match(markup, /role="list"/)
  assert.match(markup, /data-slot="attachment"/)
  assert.match(markup, /data-state="done"/)
  assert.match(markup, /data-size="sm"/)
  assert.match(markup, /data-slot="attachment-media"/)
  assert.match(markup, /data-slot="attachment-title"[^>]*>notes\.md</)
  assert.match(markup, /data-slot="attachment-description"[^>]*>Markdown · 2 KB</)
  assert.match(markup, /data-slot="attachment-action"/)
  assert.match(markup, /aria-label="Remove notes\.md"/)
})

test('exposes accessible pending and error states', () => {
  const uploading = renderToStaticMarkup(
    <Attachment state="uploading">
      <AttachmentContent>
        <AttachmentTitle>large.zip</AttachmentTitle>
      </AttachmentContent>
    </Attachment>,
  )
  const failed = renderToStaticMarkup(
    <Attachment state="error">
      <AttachmentContent>
        <AttachmentTitle>broken.pdf</AttachmentTitle>
      </AttachmentContent>
    </Attachment>,
  )

  assert.match(uploading, /aria-busy="true"/)
  assert.match(uploading, /data-state="uploading"/)
  assert.match(uploading, /group-data-\[state=uploading\]\/attachment:shimmer/)
  assert.match(failed, /aria-invalid="true"/)
  assert.match(failed, /data-state="error"/)
})
