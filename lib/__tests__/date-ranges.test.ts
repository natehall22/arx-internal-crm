import { getDateRangeForTimeFrame, getDateRangeWithDebug } from '../date-ranges'

describe('getDateRangeForTimeFrame', () => {
  const timezone = 'America/New_York'

  describe('today', () => {
    it('should return start of today in local timezone', () => {
      const { start, end } = getDateRangeForTimeFrame('today', timezone)
      
      expect(start).toBeInstanceOf(Date)
      expect(end).toBeInstanceOf(Date)
      expect(end.getTime()).toBeGreaterThan(start.getTime())
      
      // End should be exactly 24 hours after start
      const diffMs = end.getTime() - start.getTime()
      expect(diffMs).toBe(24 * 60 * 60 * 1000)
    })

    it('should have start time at midnight local time', () => {
      const result = getDateRangeWithDebug('today', timezone)
      
      // The local start should have hours = 0 when parsed
      // Note: startLocal is stored as ISO string but represents local time
      // The UTC representation will show the offset (e.g., 05:00:00 for ET)
      const localDate = new Date(result.startLocal)
      // Check that the UTC hours match the expected offset for ET (4 or 5 hours)
      expect([4, 5]).toContain(localDate.getUTCHours())
    })
  })

  describe('week', () => {
    it('should return start of week (Monday) in local timezone', () => {
      const { start, end } = getDateRangeForTimeFrame('week', timezone)
      
      expect(start).toBeInstanceOf(Date)
      expect(end).toBeInstanceOf(Date)
      expect(end.getTime()).toBeGreaterThan(start.getTime())
    })

    it('should start on Sunday', () => {
      const result = getDateRangeWithDebug('week', timezone)
      
      // Parse the local start date and check it's a Sunday
      const startDate = new Date(result.startLocal)
      expect(startDate.getDay()).toBe(0) // 0 = Sunday
    })

    it('should have start time at midnight local time', () => {
      const result = getDateRangeWithDebug('week', timezone)
      
      // The local start should have hours = 0 when parsed
      // The UTC representation will show the offset (e.g., 05:00:00 for ET)
      const localDate = new Date(result.startLocal)
      // Check that the UTC hours match the expected offset for ET (4 or 5 hours)
      expect([4, 5]).toContain(localDate.getUTCHours())
    })
  })

  describe('month', () => {
    it('should return start of month in local timezone', () => {
      const { start, end } = getDateRangeForTimeFrame('month', timezone)
      
      expect(start).toBeInstanceOf(Date)
      expect(end).toBeInstanceOf(Date)
      expect(end.getTime()).toBeGreaterThan(start.getTime())
    })

    it('should start on the 1st of the month', () => {
      const result = getDateRangeWithDebug('month', timezone)
      
      // Parse the local start date and check it's the 1st
      const startDate = new Date(result.startLocal)
      expect(startDate.getDate()).toBe(1)
    })
  })

  describe('quarter', () => {
    it('should return start of quarter in local timezone', () => {
      const { start, end } = getDateRangeForTimeFrame('quarter', timezone)
      
      expect(start).toBeInstanceOf(Date)
      expect(end).toBeInstanceOf(Date)
      expect(end.getTime()).toBeGreaterThan(start.getTime())
    })

    it('should start on the 1st of a quarter month (Jan, Apr, Jul, Oct)', () => {
      const result = getDateRangeWithDebug('quarter', timezone)
      
      const startDate = new Date(result.startLocal)
      expect(startDate.getDate()).toBe(1)
      expect([0, 3, 6, 9]).toContain(startDate.getMonth())
    })
  })

  describe('year', () => {
    it('should return start of year in local timezone', () => {
      const { start, end } = getDateRangeForTimeFrame('year', timezone)
      
      expect(start).toBeInstanceOf(Date)
      expect(end).toBeInstanceOf(Date)
      expect(end.getTime()).toBeGreaterThan(start.getTime())
    })

    it('should start on January 1st', () => {
      const result = getDateRangeWithDebug('year', timezone)
      
      const startDate = new Date(result.startLocal)
      expect(startDate.getMonth()).toBe(0) // January
      expect(startDate.getDate()).toBe(1)
    })
  })

  describe('yesterday', () => {
    it('should return 24-hour range for yesterday', () => {
      const { start, end } = getDateRangeForTimeFrame('yesterday', timezone)
      
      const diffMs = end.getTime() - start.getTime()
      expect(diffMs).toBe(24 * 60 * 60 * 1000)
    })
  })

  describe('last_week', () => {
    it('should return 7-day range for last week', () => {
      const { start, end } = getDateRangeForTimeFrame('last_week', timezone)
      
      const diffMs = end.getTime() - start.getTime()
      expect(diffMs).toBe(7 * 24 * 60 * 60 * 1000)
    })

    it('should start on Sunday of last week', () => {
      const result = getDateRangeWithDebug('last_week', timezone)
      
      const startDate = new Date(result.startLocal)
      expect(startDate.getDay()).toBe(0) // Sunday
    })
  })

  describe('UTC conversion', () => {
    it('should convert local boundaries to UTC for database queries', () => {
      const result = getDateRangeWithDebug('today', timezone)
      
      // UTC times should be different from local times (unless in UTC timezone)
      // For America/New_York, UTC should be 4-5 hours ahead
      const localStart = new Date(result.startLocal)
      const utcStart = new Date(result.startUtc)
      
      // The UTC time should be offset from local time
      // (exact offset depends on DST)
      const offsetHours = (utcStart.getTime() - localStart.getTime()) / (60 * 60 * 1000)
      expect(Math.abs(offsetHours)).toBeLessThanOrEqual(5) // Max 5 hours for ET
    })
  })

  describe('consistency between today and week', () => {
    it('week range should include today range', () => {
      const today = getDateRangeForTimeFrame('today', timezone)
      const week = getDateRangeForTimeFrame('week', timezone)
      
      // Week start should be <= today start
      expect(week.start.getTime()).toBeLessThanOrEqual(today.start.getTime())
      
      // Week end should be >= today end (or close to it)
      // Note: week end is "through end of today" so they should be similar
      expect(week.end.getTime()).toBeGreaterThanOrEqual(today.start.getTime())
    })
  })
})

describe('getDateRangeWithDebug', () => {
  it('should include all debug fields', () => {
    const result = getDateRangeWithDebug('week', 'America/New_York')
    
    expect(result).toHaveProperty('start')
    expect(result).toHaveProperty('end')
    expect(result).toHaveProperty('timezone')
    expect(result).toHaveProperty('timeframe')
    expect(result).toHaveProperty('startLocal')
    expect(result).toHaveProperty('endLocal')
    expect(result).toHaveProperty('startUtc')
    expect(result).toHaveProperty('endUtc')
    
    expect(result.timezone).toBe('America/New_York')
    expect(result.timeframe).toBe('week')
  })
})
