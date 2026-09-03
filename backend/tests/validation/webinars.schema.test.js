import { describe, expect, it } from 'vitest';
import * as schemas from '../../validation/schemas/webinars';

describe('webinar request schemas', () => {
  const validSlide = {
    expectedVersion: 1,
    anchor: 'opening',
    title: 'Opening',
    targetSeconds: 0,
    speakerNotes: '',
    html: '<section>Welcome</section>',
    css: '',
    javascript: '',
  };

  it('accepts the bounded create and content mutation contracts', () => {
    expect(schemas.createWebinar.safeParse({
      slug: 'first-time-homebuyer',
      title: 'First Time Homebuyer',
      primaryOwnerUserId: 7,
    }).success).toBe(true);
    expect(schemas.saveMaster.safeParse({
      expectedVersion: 1,
      masterHtml: '<main>{{SLIDE_CONTENT}}</main>',
      masterCss: '',
    }).success).toBe(true);
    expect(schemas.addSlide.safeParse(validSlide).success).toBe(true);
    expect(schemas.duplicateSlide.safeParse({
      expectedVersion: 1,
      sourceSlideId: '11111111-1111-4111-8111-111111111111',
    }).success).toBe(true);
    expect(schemas.saveSlide.safeParse(validSlide).success).toBe(true);
  });

  it('keeps duplicate requests source-only and add requests self-contained', () => {
    expect(schemas.addSlide.safeParse({ ...validSlide, sourceSlideId: '11111111-1111-4111-8111-111111111111' }).success).toBe(false);
    expect(schemas.duplicateSlide.safeParse({ expectedVersion: 1, sourceSlideId: '11111111-1111-4111-8111-111111111111', html: '<section>override</section>' }).success).toBe(false);
    expect(schemas.duplicateSlide.safeParse({ expectedVersion: 1 }).success).toBe(false);
  });

  it('rejects invalid webinar and slide scalar boundaries', () => {
    expect(schemas.createWebinar.safeParse({
      slug: 'Not valid',
      title: 'Title',
      primaryOwnerUserId: 7,
    }).success).toBe(false);
    expect(schemas.saveSlide.safeParse({ ...validSlide, targetSeconds: 7201 }).success).toBe(false);
    expect(schemas.saveSlide.safeParse({ ...validSlide, speakerNotes: 'x'.repeat(100 * 1024 + 1) }).success).toBe(false);
    expect(schemas.reorderSlides.safeParse({ expectedVersion: 1, slideIds: [] }).success).toBe(false);
  });

  it('accepts the remaining private mutation contracts', () => {
    expect(schemas.reorderSlides.safeParse({
      expectedVersion: 1,
      slideIds: ['11111111-1111-4111-8111-111111111111'],
    }).success).toBe(true);
    expect(schemas.restoreRevision.safeParse({ expectedVersion: 1 }).success).toBe(true);
    expect(schemas.changeOwner.safeParse({ primaryOwnerUserId: 7 }).success).toBe(true);
    expect(schemas.changeAudienceAccess.safeParse({ enabled: true }).success).toBe(true);
    expect(schemas.writeNote.safeParse({ body: 'Remember the FHA explanation.' }).success).toBe(true);
    expect(schemas.writeSettings.safeParse({ shortcuts: {}, preferences: {} }).success).toBe(true);
  });
});
