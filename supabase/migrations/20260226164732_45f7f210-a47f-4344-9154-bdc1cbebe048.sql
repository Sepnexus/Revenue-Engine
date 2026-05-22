
-- Access request form submissions
CREATE TABLE public.access_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  company_name TEXT NOT NULL,
  phone TEXT,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMP WITH TIME ZONE,
  reviewed_by UUID
);

-- Enable RLS
ALTER TABLE public.access_requests ENABLE ROW LEVEL SECURITY;

-- Anyone can submit (anon insert)
CREATE POLICY "Anyone can submit access request"
  ON public.access_requests FOR INSERT
  WITH CHECK (true);

-- Only admins can view/manage
CREATE POLICY "Admins can view access requests"
  ON public.access_requests FOR SELECT
  USING (has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "Admins can update access requests"
  ON public.access_requests FOR UPDATE
  USING (has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "Admins can delete access requests"
  ON public.access_requests FOR DELETE
  USING (has_role(auth.uid(), 'super_admin'::app_role));
