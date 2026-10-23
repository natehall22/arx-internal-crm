import { WHATS_NEW_SHOTS } from '@/lib/whats-new-shots'

it("What's new screenshots never include the role-restricted Needs-you box", () => {
  for (const shots of Object.values(WHATS_NEW_SHOTS)) {
    for (const s of shots ?? []) {
      expect(s.file).not.toMatch(/needs-you/i)
      expect(s.caption).not.toMatch(/needs you/i)
    }
  }
})
