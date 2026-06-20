package com.setminusx.ramsey.ui.client;

import com.setminusx.ramsey.ui.config.RamseyProperties;
import com.setminusx.ramsey.ui.model.CampaignDto;
import com.setminusx.ramsey.ui.model.ProgressionPointDto;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

class MwClientTest {

    private MwClient build(MockRestServiceServer[] holder) {
        RestClient.Builder builder = RestClient.builder();
        holder[0] = MockRestServiceServer.bindTo(builder).build();
        RamseyProperties props = new RamseyProperties(
                "http://mw:8080",
                new RamseyProperties.Sampler(1000),
                new RamseyProperties.Throughput(7200, 7200));
        return new MwClient(builder, props);
    }

    @Test
    void maps_campaigns() {
        MockRestServiceServer[] holder = new MockRestServiceServer[1];
        MwClient client = build(holder);
        holder[0].expect(requestTo("http://mw:8080/api/ramsey/campaigns"))
                .andRespond(withSuccess("""
                    [{"campaignId":10,"subgraphSize":8,"vertexCount":281,"totalPairs":600,
                      "strategy":"COMPREHENSIVE_EDGE_PAIR_MUTATION","status":"ACTIVE",
                      "createdDate":"2026-06-14T10:00:00","updatedDate":"2026-06-16T12:00:00"}]
                    """, APPLICATION_JSON));

        List<CampaignDto> campaigns = client.getCampaigns();
        assertThat(campaigns).hasSize(1);
        assertThat(campaigns.get(0).campaignId()).isEqualTo(10);
        assertThat(campaigns.get(0).status()).isEqualTo("ACTIVE");
        holder[0].verify();
    }

    @Test
    void maps_progression() {
        MockRestServiceServer[] holder = new MockRestServiceServer[1];
        MwClient client = build(holder);
        holder[0].expect(requestTo("http://mw:8080/api/ramsey/campaigns/10/progression"))
                .andRespond(withSuccess("""
                    [{"stageId":42,"graphId":8348,"cliqueCount":775623,"status":"ACTIVE",
                      "createdDate":"2026-06-16T12:00:00"}]
                    """, APPLICATION_JSON));

        List<ProgressionPointDto> prog = client.getProgression(10);
        assertThat(prog).hasSize(1);
        assertThat(prog.get(0).stageId()).isEqualTo(42);
        assertThat(prog.get(0).cliqueCount()).isEqualTo(775623);
        assertThat(prog.get(0).status()).isEqualTo("ACTIVE");
        holder[0].verify();
    }
}
