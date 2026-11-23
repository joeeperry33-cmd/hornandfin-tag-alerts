<?php
/**
 * Plugin Name: Horn & Fin - Ultimate Hunting and Fishing Resource
 * Description: The free hunting and fishing tools page (Plan a Hunt, Ask Horn & Fin, Draw Odds & Points, Deadlines & Reminders, Stocking Alerts, Returned Tags). Use the [hf_resource] shortcode. Also shares public listing facts with the tools and can send hunters an instant thank-you when they contact a listing (off until turned on).
 * Version: 1.0.0
 * Author: Horn & Fin
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

const HF_TOOLS_OPT = 'hf_tools_settings';
const HF_TOOLS_PAGE_SLUG = 'ultimate-hunting-fishing-resource';

function hf_tools_settings() {
	$s = get_option( HF_TOOLS_OPT, array() );
	return wp_parse_args( is_array( $s ) ? $s : array(), array(
		'api'           => 'https://leftovertagalerts.com',
		'key'           => '',
		'instant_reply' => 0,
		'reply_scope'   => 'featured', // 'featured' or 'all'
		'last_inquiry'  => 0,
		'state_col'     => '',
		'city_col'      => '',
		'county_col'    => '',
		'species_col'   => '',
	) );
}

/** On activation: make a shared key for the tools server and a DRAFT page holding the tools. */
register_activation_hook( __FILE__, function () {
	$s = hf_tools_settings();
	if ( ! $s['key'] ) { $s['key'] = wp_generate_password( 40, false, false ); }
	update_option( HF_TOOLS_OPT, $s, false );
	if ( ! get_page_by_path( HF_TOOLS_PAGE_SLUG ) ) {
		wp_insert_post( array(
			'post_type'    => 'page',
			'post_status'  => 'draft',
			'post_title'   => 'The Ultimate Hunting and Fishing Resource',
			'post_name'    => HF_TOOLS_PAGE_SLUG,
			'post_content' => "<!-- wp:paragraph --><p><strong>Free for a limited time.</strong> Plan your next hunt, check draw odds at your points, get deadline reminders and know when your favorite water gets stocked.</p><!-- /wp:paragraph -->\n<!-- wp:shortcode -->[hf_resource]<!-- /wp:shortcode -->",
		) );
	}
} );

/* ---------- The tools block ---------- */

function hf_tools_block( $atts ) {
	$a = shortcode_atts( array( 'tab' => '', 'state' => '' ), $atts );
	$s = hf_tools_settings();
	$api = esc_url( rtrim( $s['api'], '/' ) );
	return '<div id="hf-tools" data-tab="' . esc_attr( $a['tab'] ) . '" data-state="' . esc_attr( strtoupper( $a['state'] ) ) . '"><noscript>Turn on JavaScript to use the Horn &amp; Fin tools.</noscript></div>'
		. '<script src="' . $api . '/hf-tools.js" async></script>';
}
add_shortcode( 'hf_resource', 'hf_tools_block' );
add_shortcode( 'hf_tools', 'hf_tools_block' );

/* ---------- JReviews lookups ---------- */

function hf_tools_table( $name ) {
	global $wpdb;
	$t = $wpdb->prefix . 'jreviews_' . $name;
	return ( $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $t ) ) === $t ) ? $t : '';
}

function hf_tools_columns( $table ) {
	global $wpdb;
	return $table ? $wpdb->get_col( "SHOW COLUMNS FROM {$table}" ) : array();
}

/** Find the JReviews field for state/city/county/species: the setting if given, else the first column whose name fits. */
function hf_tools_pick_col( $cols, $setting, $patterns ) {
	if ( $setting && in_array( $setting, $cols, true ) ) { return $setting; }
	foreach ( $patterns as $p ) {
		foreach ( $cols as $c ) {
			if ( preg_match( $p, $c ) ) { return $c; }
		}
	}
	return '';
}

function hf_tools_fieldmap() {
	$s = hf_tools_settings();
	$cols = hf_tools_columns( hf_tools_table( 'content' ) );
	return array(
		'state'    => hf_tools_pick_col( $cols, $s['state_col'], array( '/^jr_state$/', '/^jr_.*state/' ) ),
		'city'     => hf_tools_pick_col( $cols, $s['city_col'], array( '/^jr_city$/', '/^jr_.*city/', '/^jr_.*town/' ) ),
		'county'   => hf_tools_pick_col( $cols, $s['county_col'], array( '/^jr_county$/', '/^jr_.*county/' ) ),
		'species'  => hf_tools_pick_col( $cols, $s['species_col'], array( '/^jr_species$/', '/^jr_.*species/', '/^jr_.*game/' ) ),
		'featured' => in_array( 'featured', $cols, true ) ? 'featured' : '',
		'lat'      => hf_tools_pick_col( $cols, '', array( '/^jr_lat/', '/latitude/' ) ),
		'lng'      => hf_tools_pick_col( $cols, '', array( '/^jr_lon/', '/^jr_lng/', '/longitude/' ) ),
	);
}

/** JReviews stores choice fields as *value*value*; turn that into "value, value". */
function hf_tools_clean_value( $v ) {
	$v = trim( (string) $v, "* \t\n" );
	$v = str_replace( '*', ', ', $v );
	return ucwords( str_replace( '-', ' ', $v ) );
}

/* ---------- REST: public listing facts for the tools (title, link, place, category, Featured) ---------- */

add_action( 'rest_api_init', function () {
	register_rest_route( 'hf/v1', '/listings-public', array(
		'methods'             => 'GET',
		'permission_callback' => '__return_true',
		'callback'            => 'hf_tools_listings_public',
	) );
	register_rest_route( 'hf/v1', '/tools-check', array(
		'methods'             => 'GET',
		'permission_callback' => function () { return current_user_can( 'manage_options' ); },
		'callback'            => 'hf_tools_check',
	) );
} );

function hf_tools_listings_public( WP_REST_Request $req ) {
	global $wpdb;
	$page = max( 1, (int) $req->get_param( 'page' ) );
	$per = min( 500, max( 1, (int) ( $req->get_param( 'per_page' ) ?: 500 ) ) );
	$cache_key = 'hf_tools_lp_' . $page . '_' . $per;
	$hit = get_transient( $cache_key );
	if ( false !== $hit ) { return $hit; }

	$content = hf_tools_table( 'content' );
	if ( ! $content ) { return new WP_Error( 'no_jreviews', 'JReviews tables not found', array( 'status' => 500 ) ); }
	$f = hf_tools_fieldmap();
	$extra = array();
	foreach ( array( 'state', 'city', 'county', 'species', 'featured', 'lat', 'lng' ) as $k ) {
		if ( $f[ $k ] ) { $extra[] = 'c.`' . esc_sql( $f[ $k ] ) . '` AS `hf_' . $k . '`'; }
	}
	$cols = $extra ? ', ' . implode( ', ', $extra ) : '';
	$offset = ( $page - 1 ) * $per;
	$rows = $wpdb->get_results( $wpdb->prepare(
		"SELECT p.ID, p.post_title, p.post_excerpt, p.post_content, p.post_author {$cols}
		 FROM {$wpdb->posts} p INNER JOIN {$content} c ON c.contentid = p.ID
		 WHERE p.post_status = 'publish' AND p.post_type = 'post' ORDER BY p.ID LIMIT %d OFFSET %d",
		$per + 1, $offset
	), ARRAY_A );
	$more = count( $rows ) > $per;
	$rows = array_slice( $rows, 0, $per );

	// Directory names: JReviews categories point to directories.
	$dirs = array();
	$cat_t = hf_tools_table( 'categories' );
	$dir_t = hf_tools_table( 'directories' );
	if ( $cat_t && $dir_t ) {
		foreach ( $wpdb->get_results( "SELECT c.id, d.title FROM {$cat_t} c JOIN {$dir_t} d ON d.id = c.dirid", ARRAY_A ) as $r ) { $dirs[ (int) $r['id'] ] = $r['title']; }
	}
	// Claimed = owned by someone other than the site admins.
	$admins = get_users( array( 'role' => 'administrator', 'fields' => 'ID' ) );
	$out = array();
	foreach ( $rows as $r ) {
		$cats = get_the_category( (int) $r['ID'] );
		$cat = $cats ? $cats[0] : null;
		$summary = $r['post_excerpt'] ? $r['post_excerpt'] : wp_trim_words( wp_strip_all_tags( strip_shortcodes( $r['post_content'] ) ), 60, '...' );
		$out[] = array(
			'id'        => (int) $r['ID'],
			'title'     => html_entity_decode( $r['post_title'], ENT_QUOTES ),
			'url'       => get_permalink( (int) $r['ID'] ),
			'directory' => $cat && isset( $dirs[ $cat->term_id ] ) ? $dirs[ $cat->term_id ] : '',
			'category'  => $cat ? html_entity_decode( $cat->name, ENT_QUOTES ) : '',
			'state'     => isset( $r['hf_state'] ) ? hf_tools_clean_value( $r['hf_state'] ) : '',
			'city'      => isset( $r['hf_city'] ) ? hf_tools_clean_value( $r['hf_city'] ) : '',
			'county'    => isset( $r['hf_county'] ) ? hf_tools_clean_value( $r['hf_county'] ) : '',
			'species'   => isset( $r['hf_species'] ) ? strtolower( hf_tools_clean_value( $r['hf_species'] ) ) : '',
			'summary'   => html_entity_decode( $summary, ENT_QUOTES ),
			'featured'  => ! empty( $r['hf_featured'] ),
			'claimed'   => ! in_array( (int) $r['post_author'], array_map( 'intval', $admins ), true ),
			'lat'       => isset( $r['hf_lat'] ) && is_numeric( $r['hf_lat'] ) ? (float) $r['hf_lat'] : null,
			'lng'       => isset( $r['hf_lng'] ) && is_numeric( $r['hf_lng'] ) ? (float) $r['hf_lng'] : null,
		);
	}
	$result = array( 'listings' => $out, 'more' => $more, 'page' => $page );
	set_transient( $cache_key, $result, 6 * HOUR_IN_SECONDS );
	return $result;
}

/** Admin check: which JReviews fields the tools picked, and the inquiry table's columns. */
function hf_tools_check() {
	return array(
		'version'          => '1.0.0',
		'fields'           => hf_tools_fieldmap(),
		'content_columns'  => hf_tools_columns( hf_tools_table( 'content' ) ),
		'inquiry_columns'  => hf_tools_columns( hf_tools_table( 'inquiry' ) ),
		'directories'      => hf_tools_table( 'directories' ) ? $GLOBALS['wpdb']->get_results( 'SELECT id, title FROM ' . hf_tools_table( 'directories' ) ) : array(),
		'page'             => ( $p = get_page_by_path( HF_TOOLS_PAGE_SLUG ) ) ? array( 'id' => $p->ID, 'status' => $p->post_status ) : null,
		'instant_reply_on' => (bool) hf_tools_settings()['instant_reply'],
	);
}

/* ---------- Contact Outfitter instant replies (off until turned on) ---------- */

/** JReviews saves inquiries over admin-ajax; after any JReviews request, look for new inquiries. */
add_action( 'shutdown', function () {
	if ( ! ( defined( 'DOING_AJAX' ) && DOING_AJAX ) ) { return; }
	if ( false === stripos( (string) ( $_REQUEST['action'] ?? '' ), 'jreviews' ) ) { return; }
	$s = hf_tools_settings();
	if ( ! $s['instant_reply'] || ! $s['key'] ) { return; }
	hf_tools_process_inquiries();
} );

function hf_tools_process_inquiries() {
	global $wpdb;
	$t = hf_tools_table( 'inquiry' );
	if ( ! $t ) { return; }
	$cols = hf_tools_columns( $t );
	$idcol = in_array( 'id', $cols, true ) ? 'id' : ( in_array( 'inquiry_id', $cols, true ) ? 'inquiry_id' : '' );
	$emailcol = hf_tools_pick_col( $cols, '', array( '/^from_email$/', '/^email$/', '/email/' ) );
	$namecol = hf_tools_pick_col( $cols, '', array( '/^from_name$/', '/^name$/', '/name/' ) );
	$msgcol = hf_tools_pick_col( $cols, '', array( '/^message$/', '/^body$/', '/message|text|body/' ) );
	if ( ! $idcol || ! $emailcol || ! in_array( 'listing_id', $cols, true ) ) { return; }
	$s = hf_tools_settings();
	if ( ! $s['last_inquiry'] ) {
		// First run: start from the newest inquiry so nobody from the past gets a reply.
		$s['last_inquiry'] = (int) $wpdb->get_var( "SELECT MAX(`{$idcol}`) FROM {$t}" );
		update_option( HF_TOOLS_OPT, $s, false );
		return;
	}
	$rows = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM {$t} WHERE `{$idcol}` > %d ORDER BY `{$idcol}` LIMIT 5", (int) $s['last_inquiry'] ), ARRAY_A );
	$f = hf_tools_fieldmap();
	$content = hf_tools_table( 'content' );
	foreach ( $rows as $r ) {
		$s['last_inquiry'] = (int) $r[ $idcol ];
		update_option( HF_TOOLS_OPT, $s, false );
		$post = get_post( (int) $r['listing_id'] );
		$to = sanitize_email( $r[ $emailcol ] );
		if ( ! $post || ! is_email( $to ) ) { continue; }
		if ( 'featured' === $s['reply_scope'] ) {
			$featured = $f['featured'] ? (int) $wpdb->get_var( $wpdb->prepare( "SELECT `featured` FROM {$content} WHERE contentid = %d", $post->ID ) ) : 0;
			if ( ! $featured ) { continue; }
		}
		if ( get_post_meta( $post->ID, 'hf_instant_reply_off', true ) ) { continue; }
		$res = wp_remote_post( rtrim( $s['api'], '/' ) . '/api/hf/inquiry-reply', array(
			'timeout' => 15,
			'headers' => array( 'content-type' => 'application/json', 'x-hf-key' => $s['key'] ),
			'body'    => wp_json_encode( array(
				'listing_title'   => $post->post_title,
				'listing_url'     => get_permalink( $post ),
				'listing_summary' => wp_trim_words( wp_strip_all_tags( strip_shortcodes( $post->post_content ) ), 180, '' ),
				'hunter_name'     => $namecol ? $r[ $namecol ] : '',
				'message'         => $msgcol ? $r[ $msgcol ] : '',
			) ),
		) );
		if ( is_wp_error( $res ) || 200 !== wp_remote_retrieve_response_code( $res ) ) { continue; }
		$body = json_decode( wp_remote_retrieve_body( $res ), true );
		if ( empty( $body['reply'] ) ) { continue; }
		$text = $body['reply'] . "\n\n---\nThis is an automatic note sent through Horn & Fin. " . html_entity_decode( $post->post_title, ENT_QUOTES ) . " will reply to you directly.\n" . get_permalink( $post );
		wp_mail( $to, 'Thanks for contacting ' . html_entity_decode( $post->post_title, ENT_QUOTES ), $text, array( 'Reply-To: info@hornandfin.com' ) );
	}
}

/* ---------- Settings page ---------- */

add_action( 'admin_menu', function () {
	add_options_page( 'Horn & Fin Tools', 'Horn & Fin Tools', 'manage_options', 'hf-tools', 'hf_tools_settings_page' );
} );

function hf_tools_settings_page() {
	if ( ! current_user_can( 'manage_options' ) ) { return; }
	$s = hf_tools_settings();
	if ( isset( $_POST['hf_tools_save'] ) && check_admin_referer( 'hf_tools_save' ) ) {
		$s['api'] = esc_url_raw( wp_unslash( $_POST['api'] ?? $s['api'] ) );
		$s['instant_reply'] = empty( $_POST['instant_reply'] ) ? 0 : 1;
		$s['reply_scope'] = ( 'all' === ( $_POST['reply_scope'] ?? '' ) ) ? 'all' : 'featured';
		foreach ( array( 'state_col', 'city_col', 'county_col', 'species_col' ) as $k ) { $s[ $k ] = sanitize_key( wp_unslash( $_POST[ $k ] ?? '' ) ); }
		if ( ! $s['key'] ) { $s['key'] = wp_generate_password( 40, false, false ); }
		update_option( HF_TOOLS_OPT, $s, false );
		foreach ( range( 1, 40 ) as $p ) { delete_transient( 'hf_tools_lp_' . $p . '_500' ); }
		echo '<div class="updated"><p>Saved.</p></div>';
	}
	$f = hf_tools_fieldmap();
	$page = get_page_by_path( HF_TOOLS_PAGE_SLUG );
	?>
	<div class="wrap"><h1>Horn &amp; Fin Tools</h1>
	<p>The tools page: <?php echo $page ? '<a href="' . esc_url( get_edit_post_link( $page->ID ) ) . '">' . esc_html( $page->post_title ) . '</a> (' . esc_html( $page->post_status ) . ')' : 'not found. Add [hf_resource] to any page.'; ?></p>
	<form method="post"><?php wp_nonce_field( 'hf_tools_save' ); ?>
	<table class="form-table">
	<tr><th>Tools server</th><td><input name="api" class="regular-text" value="<?php echo esc_attr( $s['api'] ); ?>"></td></tr>
	<tr><th>Shared key</th><td><code><?php echo esc_html( $s['key'] ); ?></code><p class="description">Save this in Cloudflare as the secret <code>HF_PLUGIN_KEY</code> on the leftover-tag-alerts worker. It lets this site ask for instant replies.</p></td></tr>
	<tr><th>Instant replies</th><td><label><input type="checkbox" name="instant_reply" value="1" <?php checked( $s['instant_reply'] ); ?>> Send hunters a short thank-you when they contact a listing</label><br>
	<label><input type="radio" name="reply_scope" value="featured" <?php checked( 'featured', $s['reply_scope'] ); ?>> Featured listings only</label>
	<label style="margin-left:12px"><input type="radio" name="reply_scope" value="all" <?php checked( 'all', $s['reply_scope'] ); ?>> All listings</label>
	<p class="description">Owners can turn it off for one listing with the custom field <code>hf_instant_reply_off</code> = 1.</p></td></tr>
	<tr><th>JReviews fields</th><td>
	<?php foreach ( array( 'state', 'city', 'county', 'species' ) as $k ) : ?>
		<label><?php echo esc_html( ucfirst( $k ) ); ?> <input name="<?php echo esc_attr( $k ); ?>_col" value="<?php echo esc_attr( $s[ $k . '_col' ] ); ?>" placeholder="<?php echo esc_attr( $f[ $k ] ?: 'not found' ); ?>"></label><br>
	<?php endforeach; ?>
	<p class="description">Leave blank to use the field shown in grey. Featured flag: <?php echo $f['featured'] ? 'found' : 'not found'; ?>.</p></td></tr>
	</table>
	<p><button class="button button-primary" name="hf_tools_save" value="1">Save</button></p></form></div>
	<?php
}
