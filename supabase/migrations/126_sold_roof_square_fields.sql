-- Support sold roof square tracking from proposal to project/job board
ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS measured_squares NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS sold_waste_percent NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS sold_squares NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS recommended_order_squares NUMERIC(10, 2);

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS sold_roof_squares NUMERIC(10, 2);

COMMENT ON COLUMN proposals.measured_squares IS 'Measured roof squares before waste from proposal builder';
COMMENT ON COLUMN proposals.sold_waste_percent IS 'Waste percent applied to measured squares in proposal builder';
COMMENT ON COLUMN proposals.sold_squares IS 'Sold roof squares including waste from proposal builder';
COMMENT ON COLUMN proposals.recommended_order_squares IS 'Rounded ordering recommendation derived from sold squares';
COMMENT ON COLUMN projects.sold_roof_squares IS 'Sold roof squares including waste copied from accepted proposal';

WITH inferred_proposal_values AS (
  SELECT
    pli.proposal_id,
    MAX(
      CASE
        WHEN pli.description ~ '=\\s*([0-9]+(?:\\.[0-9]+)?)\\s*sq'
          THEN ((regexp_match(pli.description, '=\\s*([0-9]+(?:\\.[0-9]+)?)\\s*sq'))[1])::numeric
        WHEN lower(coalesce(pli.unit, '')) IN ('square', 'squares', 'sq')
          THEN pli.quantity
        ELSE NULL
      END
    ) AS sold_squares,
    MAX(
      CASE
        WHEN pli.description ~ '([0-9]+(?:\\.[0-9]+)?)\\s*sq\\s*\\+'
          THEN ((regexp_match(pli.description, '([0-9]+(?:\\.[0-9]+)?)\\s*sq\\s*\\+'))[1])::numeric
        ELSE NULL
      END
    ) AS measured_squares,
    MAX(
      CASE
        WHEN pli.description ~ '\\+\\s*([0-9]+(?:\\.[0-9]+)?)%\\s*waste'
          THEN ((regexp_match(pli.description, '\\+\\s*([0-9]+(?:\\.[0-9]+)?)%\\s*waste'))[1])::numeric
        ELSE NULL
      END
    ) AS sold_waste_percent,
    MAX(
      CASE
        WHEN pli.description ~ 'order rec:\\s*([0-9]+(?:\\.[0-9]+)?)\\s*sq'
          THEN ((regexp_match(pli.description, 'order rec:\\s*([0-9]+(?:\\.[0-9]+)?)\\s*sq'))[1])::numeric
        ELSE NULL
      END
    ) AS recommended_order_squares
  FROM proposal_line_items pli
  WHERE coalesce(pli.is_adder, false) = false
  GROUP BY pli.proposal_id
)
UPDATE proposals p
SET
  measured_squares = COALESCE(p.measured_squares, inferred.measured_squares),
  sold_waste_percent = COALESCE(p.sold_waste_percent, inferred.sold_waste_percent),
  sold_squares = COALESCE(p.sold_squares, inferred.sold_squares),
  recommended_order_squares = COALESCE(p.recommended_order_squares, inferred.recommended_order_squares)
FROM inferred_proposal_values inferred
WHERE p.id = inferred.proposal_id;

WITH latest_accepted_proposals AS (
  SELECT DISTINCT ON (p2.org_id, p2.opportunity_id)
    p2.org_id,
    p2.opportunity_id,
    p2.sold_squares
  FROM proposals p2
  WHERE p2.opportunity_id IS NOT NULL
    AND p2.accepted_at IS NOT NULL
    AND p2.sold_squares IS NOT NULL
  ORDER BY p2.org_id, p2.opportunity_id, p2.accepted_at DESC
)
UPDATE projects p
SET sold_roof_squares = COALESCE(p.sold_roof_squares, lap.sold_squares)
FROM latest_accepted_proposals lap
WHERE p.org_id = lap.org_id
  AND p.opportunity_id = lap.opportunity_id
  AND p.sold_roof_squares IS NULL;

WITH latest_accepted_proposals AS (
  SELECT DISTINCT ON (p2.org_id, p2.project_id)
    p2.org_id,
    p2.project_id,
    p2.id
  FROM proposals p2
  WHERE p2.project_id IS NOT NULL
    AND p2.accepted_at IS NOT NULL
  ORDER BY p2.org_id, p2.project_id, p2.accepted_at DESC
)
UPDATE production_jobs j
SET accepted_proposal_id = lap.id
FROM latest_accepted_proposals lap
WHERE j.org_id = lap.org_id
  AND j.project_id = lap.project_id
  AND j.accepted_proposal_id IS NULL;
