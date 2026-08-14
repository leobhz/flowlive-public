ALTER TABLE public_lives ADD COLUMN profile_avatar TEXT;
ALTER TABLE public_lives ADD COLUMN profile_bio TEXT;
ALTER TABLE public_lives ADD COLUMN instagram_handle TEXT;
ALTER TABLE public_lives ADD COLUMN instagram_url TEXT;
ALTER TABLE public_lives ADD COLUMN wallpaper_url TEXT;
ALTER TABLE public_lives ADD COLUMN wallpaper_preset TEXT NOT NULL DEFAULT 'minimal';
