/*
 * Genera un codestream JPEG 2000 **Part 2** con transformación multicomponente por matriz (array-based MCT,
 * marcadores MCT/MCC/MCO; Rsiz = PART2 | EXT_MCT) a partir de un PPM (P6, 8 bits).
 * Lo usa gen_test_dicoms.py para el caso t27 (TS 1.2.840.10008.1.2.4.92/.93).
 * El opj_compress de las distros no acepta -m (falta en su getopt), por eso existe esto.
 *
 *   gcc -O2 -I/usr/include/openjpeg-2.5 j2k_part2_mct.c -lopenjp2 -o j2k_part2_mct
 *   ./j2k_part2_mct in.ppm out.j2k
 */
#include <openjpeg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(int argc, char **argv) {
    if (argc != 3) { fprintf(stderr, "uso: %s in.ppm out.j2k\n", argv[0]); return 2; }
    FILE *f = fopen(argv[1], "rb");
    int w, h, maxval;
    if (!f || fscanf(f, "P6 %d %d %d", &w, &h, &maxval) != 3 || maxval != 255) { fprintf(stderr, "PPM P6 8 bits\n"); return 1; }
    fgetc(f);
    unsigned char *rgb = malloc((size_t)w * h * 3);
    if (fread(rgb, 1, (size_t)w * h * 3, f) != (size_t)w * h * 3) { fprintf(stderr, "PPM corto\n"); return 1; }
    fclose(f);

    opj_image_cmptparm_t cmpt[3];
    memset(cmpt, 0, sizeof(cmpt));
    for (int c = 0; c < 3; c++) { cmpt[c].dx = cmpt[c].dy = 1; cmpt[c].w = w; cmpt[c].h = h; cmpt[c].prec = 8; cmpt[c].sgnd = 0; }
    opj_image_t *img = opj_image_create(3, cmpt, OPJ_CLRSPC_SRGB);
    img->x0 = img->y0 = 0; img->x1 = w; img->y1 = h;
    for (int i = 0; i < w * h; i++) for (int c = 0; c < 3; c++) img->comps[c].data[i] = rgb[i * 3 + c];

    opj_cparameters_t p;
    opj_set_default_encoder_parameters(&p);
    p.tcp_numlayers = 1; p.tcp_rates[0] = 0; p.cp_disto_alloc = 1; /* sin pérdida por cuantización (la MCT float sí redondea) */
    float matrix[9] = { 1, 0, 0,  -1, 1, 0,  -1, 0, 1 };   /* R, G-R, B-R */
    int dc[3] = { 0, 0, 0 };
    if (!opj_set_MCT(&p, matrix, dc, 3)) { fprintf(stderr, "opj_set_MCT falló\n"); return 1; }

    opj_codec_t *codec = opj_create_compress(OPJ_CODEC_J2K);
    if (!opj_setup_encoder(codec, &p, img)) { fprintf(stderr, "setup\n"); return 1; }
    opj_stream_t *s = opj_stream_create_default_file_stream(argv[2], OPJ_FALSE);
    if (!s || !opj_start_compress(codec, img, s) || !opj_encode(codec, s) || !opj_end_compress(codec, s)) {
        fprintf(stderr, "compresión falló\n"); return 1;
    }
    opj_stream_destroy(s); opj_destroy_codec(codec); opj_image_destroy(img); free(rgb); free(p.mct_data);
    return 0;
}
