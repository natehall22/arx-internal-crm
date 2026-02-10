# Development Decisions & Assumptions

This document outlines key decisions made during development and assumptions that may need to be revisited.

## Architecture Decisions

### 1. PDF Generation
**Decision**: Use `@react-pdf/renderer` for server-side PDF generation
**Rationale**: React-pdf provides a React-like API for PDF generation, making it easier to maintain
**Note**: React-pdf may have limitations in Next.js API routes. If issues arise, consider:
- Using Playwright/Puppeteer for HTML-to-PDF conversion
- Using a dedicated PDF service
- Generating PDFs in a separate worker process

### 2. Real-time Calculations
**Decision**: Calculate estimate totals client-side for immediate feedback, then sync to server
**Rationale**: Better UX with instant updates as user changes values
**Trade-off**: Requires careful state management to avoid inconsistencies

### 3. Required Adders Validation
**Decision**: Rules-based validation with optional AI suggestions
**Rationale**: Ensures business rules are enforced while AI provides helpful context
**Implementation**: Validation runs both client-side (for UX) and server-side (for PDF generation)

### 4. Org Isolation
**Decision**: All tables include `org_id` with RLS policies for isolation
**Rationale**: Multi-tenant ready from day one, even if only one org initially
**Security**: RLS policies ensure users can only access their org's data

### 5. Snapshot Pricing
**Decision**: Estimate lines store `name` and `unit_price` at creation time
**Rationale**: Pricebook changes should not affect historical estimates
**Implementation**: When adding from pricebook, snapshot current values

## Assumptions Made

### 1. User Management
**Assumption**: Admin users will be created manually in Supabase Auth dashboard initially
**Future**: Could add user invitation flow or self-registration with approval

### 2. Google Maps Integration
**Assumption**: Map integration is scaffolded but not fully implemented
**Reason**: Requires API key and additional setup
**Status**: Placeholder UI shows coordinate data; full map requires Google Maps API key

### 3. File Uploads
**Assumption**: File upload UI is not implemented in MVP
**Reason**: Focus on core estimating functionality first
**Storage**: Supabase Storage bucket and policies are set up, ready for implementation

### 4. Email Sending
**Assumption**: Email sending for proposals is not implemented
**Future**: Could integrate with SendGrid, Resend, or Supabase Edge Functions

### 5. Steep/High Multiplier Tiers
**Assumption**: Multipliers are entered as percentages (0.10 = 10%)
**Default Tiers**: 
- Steep: [0, 0.10, 0.20, 0.30]
- High: [0, 0.10, 0.15]
**Future**: Could add UI for selecting from predefined tiers

### 6. Tax Rate
**Assumption**: Default tax rate is 8% (0.08)
**Future**: Could make this configurable per org or per estimate

### 7. Pricebook Structure
**Assumption**: Single default pricebook per org
**Future**: Could support multiple pricebooks with versioning

### 8. Estimate Status Workflow
**Assumption**: Simple status enum: draft → sent → approved/declined
**Future**: Could add more granular statuses or approval workflows

## Technical Decisions

### 1. Next.js App Router
**Decision**: Use App Router (not Pages Router)
**Rationale**: Modern Next.js approach with better server component support

### 2. Supabase SSR
**Decision**: Use `@supabase/ssr` for server-side rendering support
**Rationale**: Proper cookie handling for auth in Next.js App Router

### 3. Type Safety
**Decision**: Full TypeScript with shared database types
**Rationale**: Catch errors at compile time, better DX

### 4. Testing
**Decision**: Jest for unit tests, focus on business logic
**Rationale**: Calculation and validation logic is critical and should be tested
**Coverage**: Currently tests calculations and required adders validation

### 5. Error Handling
**Decision**: Basic error handling with user-friendly messages
**Future**: Could add error logging service (Sentry, etc.)

## Known Limitations

1. **PDF Generation**: React-pdf may need adjustment for production use
2. **Map Integration**: Requires Google Maps API key and additional implementation
3. **File Uploads**: UI not implemented, but storage is ready
4. **Email**: Not implemented
5. **Mobile**: Not optimized for mobile (desktop-first)
6. **Offline**: No offline support
7. **Real-time**: No real-time collaboration features

## Future Enhancements

- [ ] Full Google Maps integration with pin drops and lead creation
- [ ] File upload UI for photos and documents
- [ ] Email sending for proposals
- [ ] Mobile-responsive design
- [ ] Advanced reporting and analytics
- [ ] Multi-pricebook support
- [ ] Estimate templates
- [ ] Approval workflows
- [ ] Integration with accounting software
- [ ] Mobile app (React Native)
