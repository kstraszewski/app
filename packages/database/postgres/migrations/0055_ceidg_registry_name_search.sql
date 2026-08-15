-- Treat the official CEIDG name as part of both client and linked-case search.

CREATE OR REPLACE FUNCTION private.crm_client_search_projection(
  target_organization_id uuid,
  target_client_id uuid
)
RETURNS TABLE(search_text text, search_vector tsvector)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
  SELECT
    private.crm_search_normalize(concat_ws(
      ' ',
      client.display_name,
      client.primary_email,
      client.primary_phone,
      client.primary_phone_normalized,
      client.lead_source,
      client.notes,
      array_to_string(client.tags, ' '),
      identifiers.identifiers_text,
      people.people_text
    )),
    setweight(to_tsvector('simple', private.crm_search_normalize(client.display_name)), 'A')
      || setweight(to_tsvector('simple', private.crm_search_normalize(concat_ws(
        ' ',
        client.primary_email,
        client.primary_phone,
        client.primary_phone_normalized,
        array_to_string(client.tags, ' ')
      ))), 'B')
      || setweight(to_tsvector('simple', private.crm_search_normalize(identifiers.identifiers_text)), 'B')
      || setweight(to_tsvector('simple', private.crm_search_normalize(people.people_text)), 'B')
      || setweight(to_tsvector('simple', private.crm_search_normalize(concat_ws(
        ' ', client.lead_source, client.notes
      ))), 'C')
  FROM public.crm_clients client
  LEFT JOIN LATERAL (
    SELECT concat_ws(
      ' ',
      client.metadata ->> 'registry_name',
      client.metadata ->> 'tax_id',
      client.metadata ->> 'nip',
      client.metadata ->> 'regon',
      client.metadata ->> 'krs',
      client.metadata ->> 'registry_number',
      nullif(regexp_replace(coalesce(client.metadata ->> 'tax_id', ''), '[^0-9]+', '', 'g'), ''),
      nullif(regexp_replace(coalesce(client.metadata ->> 'nip', ''), '[^0-9]+', '', 'g'), ''),
      nullif(regexp_replace(coalesce(client.metadata ->> 'regon', ''), '[^0-9]+', '', 'g'), ''),
      nullif(regexp_replace(coalesce(client.metadata ->> 'krs', ''), '[^0-9]+', '', 'g'), ''),
      nullif(regexp_replace(coalesce(client.metadata ->> 'registry_number', ''), '[^0-9]+', '', 'g'), '')
    ) AS identifiers_text
  ) identifiers ON true
  LEFT JOIN LATERAL (
    SELECT string_agg(concat_ws(
      ' ',
      person.display_name,
      person.first_name,
      person.last_name,
      person.email,
      person.phone,
      person.phone_normalized,
      person.pesel,
      nullif(regexp_replace(coalesce(person.pesel, ''), '[^0-9]+', '', 'g'), '')
    ), ' ' ORDER BY person.created_at, person.id) AS people_text
    FROM public.crm_client_people person
    WHERE person.organization_id = client.organization_id
      AND person.client_id = client.id
  ) people ON true
  WHERE client.organization_id = target_organization_id
    AND client.id = target_client_id;
$$;

CREATE OR REPLACE FUNCTION private.set_crm_client_search_projection()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  people_text text;
  identifiers_text text;
  primary_phone_digits text;
BEGIN
  SELECT string_agg(concat_ws(
    ' ',
    person.display_name,
    person.first_name,
    person.last_name,
    person.email,
    person.phone,
    person.phone_normalized,
    person.pesel,
    nullif(regexp_replace(coalesce(person.pesel, ''), '[^0-9]+', '', 'g'), '')
  ), ' ' ORDER BY person.created_at, person.id)
  INTO people_text
  FROM public.crm_client_people person
  WHERE person.organization_id = NEW.organization_id
    AND person.client_id = NEW.id;

  primary_phone_digits := nullif(
    regexp_replace(coalesce(NEW.primary_phone, ''), '[^0-9]+', '', 'g'),
    ''
  );
  identifiers_text := concat_ws(
    ' ',
    NEW.metadata ->> 'registry_name',
    NEW.metadata ->> 'tax_id',
    NEW.metadata ->> 'nip',
    NEW.metadata ->> 'regon',
    NEW.metadata ->> 'krs',
    NEW.metadata ->> 'registry_number',
    nullif(regexp_replace(coalesce(NEW.metadata ->> 'tax_id', ''), '[^0-9]+', '', 'g'), ''),
    nullif(regexp_replace(coalesce(NEW.metadata ->> 'nip', ''), '[^0-9]+', '', 'g'), ''),
    nullif(regexp_replace(coalesce(NEW.metadata ->> 'regon', ''), '[^0-9]+', '', 'g'), ''),
    nullif(regexp_replace(coalesce(NEW.metadata ->> 'krs', ''), '[^0-9]+', '', 'g'), ''),
    nullif(regexp_replace(coalesce(NEW.metadata ->> 'registry_number', ''), '[^0-9]+', '', 'g'), '')
  );

  NEW.search_text := private.crm_search_normalize(concat_ws(
    ' ',
    NEW.display_name,
    NEW.primary_email,
    NEW.primary_phone,
    primary_phone_digits,
    NEW.lead_source,
    NEW.notes,
    array_to_string(NEW.tags, ' '),
    identifiers_text,
    people_text
  ));
  NEW.search_vector :=
    setweight(to_tsvector('simple', private.crm_search_normalize(NEW.display_name)), 'A')
    || setweight(to_tsvector('simple', private.crm_search_normalize(concat_ws(
      ' ',
      NEW.primary_email,
      NEW.primary_phone,
      primary_phone_digits,
      array_to_string(NEW.tags, ' ')
    ))), 'B')
    || setweight(to_tsvector('simple', private.crm_search_normalize(identifiers_text)), 'B')
    || setweight(to_tsvector('simple', private.crm_search_normalize(people_text)), 'B')
    || setweight(to_tsvector('simple', private.crm_search_normalize(concat_ws(
      ' ', NEW.lead_source, NEW.notes
    ))), 'C');

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.crm_case_search_projection(
  target_organization_id uuid,
  target_case_id uuid
)
RETURNS TABLE(search_text text, search_vector tsvector)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
  SELECT
    private.crm_search_normalize(concat_ws(
      ' ',
      crm_case.title,
      crm_case.description,
      crm_case.status_code,
      clients.clients_text,
      items.items_text,
      properties.properties_text,
      offers.offers_text
    )),
    setweight(to_tsvector('simple', private.crm_search_normalize(crm_case.title)), 'A')
      || setweight(to_tsvector('simple', private.crm_search_normalize(clients.clients_text)), 'B')
      || setweight(to_tsvector('simple', private.crm_search_normalize(items.items_text)), 'B')
      || setweight(to_tsvector('simple', private.crm_search_normalize(properties.properties_text)), 'B')
      || setweight(to_tsvector('simple', private.crm_search_normalize(offers.offers_text)), 'B')
      || setweight(to_tsvector('simple', private.crm_search_normalize(concat_ws(
        ' ', crm_case.description, crm_case.status_code
      ))), 'C')
  FROM public.crm_cases crm_case
  LEFT JOIN LATERAL (
    SELECT string_agg(concat_ws(
      ' ',
      client.display_name,
      client.primary_email,
      client.primary_phone,
      client.primary_phone_normalized,
      nullif(regexp_replace(coalesce(client.primary_phone, ''), '[^0-9]+', '', 'g'), ''),
      client.metadata ->> 'registry_name',
      client.metadata ->> 'tax_id',
      client.metadata ->> 'nip',
      client.metadata ->> 'regon',
      client.metadata ->> 'krs',
      client.metadata ->> 'registry_number',
      nullif(regexp_replace(coalesce(client.metadata ->> 'tax_id', ''), '[^0-9]+', '', 'g'), ''),
      nullif(regexp_replace(coalesce(client.metadata ->> 'nip', ''), '[^0-9]+', '', 'g'), ''),
      nullif(regexp_replace(coalesce(client.metadata ->> 'regon', ''), '[^0-9]+', '', 'g'), ''),
      nullif(regexp_replace(coalesce(client.metadata ->> 'krs', ''), '[^0-9]+', '', 'g'), ''),
      nullif(regexp_replace(coalesce(client.metadata ->> 'registry_number', ''), '[^0-9]+', '', 'g'), ''),
      (
        SELECT string_agg(concat_ws(
          ' ',
          person.display_name,
          person.first_name,
          person.last_name,
          person.email,
          person.phone,
          person.phone_normalized,
          nullif(regexp_replace(coalesce(person.phone, ''), '[^0-9]+', '', 'g'), ''),
          person.pesel,
          nullif(regexp_replace(coalesce(person.pesel, ''), '[^0-9]+', '', 'g'), '')
        ), ' ' ORDER BY person.created_at, person.id)
        FROM public.crm_client_people person
        WHERE person.organization_id = client.organization_id
          AND person.client_id = client.id
      )
    ), ' ' ORDER BY case_client.is_primary DESC, client.display_name, client.id) AS clients_text
    FROM public.crm_case_clients case_client
    JOIN public.crm_clients client
      ON client.organization_id = case_client.organization_id
     AND client.id = case_client.client_id
    WHERE case_client.organization_id = crm_case.organization_id
      AND case_client.case_id = crm_case.id
  ) clients ON true
  LEFT JOIN LATERAL (
    SELECT string_agg(concat_ws(
      ' ', item.title, item.status_code, product_type.name, product_type.code, product_type.domain
    ), ' ' ORDER BY item.created_at, item.id) AS items_text
    FROM public.crm_case_items item
    JOIN public.crm_product_types product_type ON product_type.id = item.product_type_id
    WHERE item.organization_id = crm_case.organization_id
      AND item.case_id = crm_case.id
  ) items ON true
  LEFT JOIN LATERAL (
    SELECT string_agg(concat_ws(
      ' ',
      property.listing_title,
      property.address,
      property.city,
      property.postal_code,
      property.property_type,
      property.market_type,
      property.description
    ), ' ' ORDER BY property.created_at, property.id) AS properties_text
    FROM public.crm_properties property
    LEFT JOIN public.crm_case_items property_item
      ON property_item.organization_id = property.organization_id
     AND property_item.id = property.case_item_id
    WHERE property.organization_id = crm_case.organization_id
      AND coalesce(property.case_id, property_item.case_id) = crm_case.id
  ) properties ON true
  LEFT JOIN LATERAL (
    SELECT string_agg(concat_ws(
      ' ',
      snapshot.bank_name,
      snapshot.product_name,
      snapshot.version_key,
      snapshot.catalog_snapshot -> 'version' ->> 'reference_rate_code'
    ), ' ' ORDER BY snapshot.saved_at, snapshot.id) AS offers_text
    FROM public.crm_case_offer_snapshots snapshot
    WHERE snapshot.organization_id = crm_case.organization_id
      AND snapshot.case_id = crm_case.id
  ) offers ON true
  WHERE crm_case.organization_id = target_organization_id
    AND crm_case.id = target_case_id;
$$;

DROP TRIGGER crm_clients_refresh_case_search_projection ON public.crm_clients;

CREATE TRIGGER crm_clients_refresh_case_search_projection
  AFTER UPDATE OF display_name, primary_email, primary_phone, metadata, search_text
  ON public.crm_clients
  FOR EACH ROW
  EXECUTE FUNCTION private.refresh_crm_case_search_from_client();
