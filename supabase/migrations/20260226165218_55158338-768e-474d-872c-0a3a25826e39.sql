
-- Drop the restrictive insert policy and recreate as permissive
DROP POLICY IF EXISTS "Anyone can submit access request" ON public.access_requests;

CREATE POLICY "Anyone can submit access request"
ON public.access_requests
FOR INSERT
TO anon, authenticated
WITH CHECK (true);
