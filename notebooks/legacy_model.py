import sys
import json
class DkPredictor:
    def __init__(self):
        pass
    
    def interpolate_sentence(self, smin, smax, dmin, dmax, damount):
        if damount > dmax:
            return smax
        return smin + (smax-smin)/(dmax-dmin) * min(dmax-dmin, damount-dmin)
    
    def predict_cocaine(self, amount):
        if amount < 10:
            return self.interpolate_sentence(24, 60, 0, 10, amount)
        elif amount < 50:
            return self.interpolate_sentence(60, 96, 10, 50, amount)
        elif amount < 200:
            return self.interpolate_sentence(96, 144, 50, 200, amount)
        elif amount < 400:
            return self.interpolate_sentence(144, 180, 200, 400, amount)
        elif amount < 600:
            return self.interpolate_sentence(180, 240, 400, 600, amount)
        elif amount < 1200:
            return self.interpolate_sentence(240, 276, 600, 1200, amount)
        elif amount < 4000:
            return self.interpolate_sentence(276, 312, 1200, 4000, amount)
        elif amount < 15000:
            return self.interpolate_sentence(312, 360, 4000, 15000, amount)
        else:
            return self.interpolate_sentence(360, 420, 15000, 100000, amount)
        
    def predict_heroin(self, amount):
        return self.predict_cocaine(amount)
        
    def predict_meth(self, amount):
        if amount < 10:
            return self.interpolate_sentence(36, 84, 0, 10, amount)
        elif amount < 70:
            return self.interpolate_sentence(84, 132, 10, 70, amount)
        elif amount < 300:
            return self.interpolate_sentence(132, 180, 70, 300, amount)
        elif amount < 600:
            return self.interpolate_sentence(180, 240, 300, 600, amount)
        elif amount < 1200:
            return self.interpolate_sentence(240, 276, 600, 1200, amount)
        elif amount < 4000:
            return self.interpolate_sentence(276, 312, 1200, 4000, amount)
        elif amount < 15000:
            return self.interpolate_sentence(312, 360, 4000, 15000, amount)
        else:
            return self.interpolate_sentence(360, 420, 15000, 100000, amount)
        
    def predict_ketamine(self, amount):
        if amount < 1:
            return self.interpolate_sentence(12, 24, 0, 1, amount)
        elif amount < 10:
            return self.interpolate_sentence(24, 48, 1, 10, amount)
        elif amount < 50:
            return self.interpolate_sentence(48, 72, 10, 50, amount)
        elif amount < 300:
            return self.interpolate_sentence(72, 108, 50, 300, amount)
        elif amount < 600:
            return self.interpolate_sentence(108, 144, 300, 600, amount)
        elif amount < 1000:
            return self.interpolate_sentence(144, 168, 600, 1000, amount)
        elif amount < 2000:  # HKSAR v. SIN CHUNG KIN
            return self.interpolate_sentence(168, 216, 1000, 2000, amount)
        elif amount < 3000:  # HKSAR v. SIN CHUNG KIN
            return self.interpolate_sentence(216, 240, 2000, 3000, amount)
        else: #HKSAR v. HO CHI HENG
            return self.predict_cocaine(amount) * 0.806

    def predict_nimetazepam(self, amount):
        return self.predict_ketamine(amount)

    def predict_ecstasy(self, amount):
        #Secretary for Justice v HII Siew-cheng
        return self.predict_ketamine(amount)

    def predict_cannabisresin(self, amount):
        if amount < 10:
            return 2
        elif amount < 100:
            return 3
        elif amount < 300:
            return 4
        elif amount < 500:
            return 6
        elif amount < 750:
            return 8
        elif amount < 1000:
            return 10
        elif amount < 2000:
            return self.interpolate_sentence(10, 16, 0, 2000, amount)
        elif amount < 3000:
            return self.interpolate_sentence(16, 24, 2000, 3000, amount)
        elif amount < 6000:
            return self.interpolate_sentence(24, 36, 3000, 6000, amount)
        elif amount < 9000:
            return self.interpolate_sentence(36, 48, 6000, 9000, amount)
        else:
            return self.interpolate_sentence(48, 72, 9000, 100000, amount)
            
    def predict_herbalcannabis(self, amount):
        return self.predict_cannabisresin(amount / 4)

        
    def get_starting_point(self, cocaine_amount, heroin_amount,
                            meth_amount, ketamine_amount,
                            nimetazepam_amount, ecstasy_amount,
                            cannabisresin_amount, herbalcannabis_amount):
        starting = 0
        total_amount = cocaine_amount + heroin_amount + \
                           meth_amount + ketamine_amount +\
                           nimetazepam_amount + ecstasy_amount +\
                           cannabisresin_amount + herbalcannabis_amount

        if total_amount > 0:
            starting = (self.predict_cocaine(total_amount) * cocaine_amount +
                            self.predict_heroin(total_amount) * heroin_amount +
                            self.predict_meth(total_amount) * meth_amount +
                            self.predict_ketamine(total_amount) * ketamine_amount +
                            self.predict_nimetazepam(total_amount) * nimetazepam_amount +
                            self.predict_ecstasy(total_amount) * ecstasy_amount +
                            self.predict_cannabisresin(total_amount) * cannabisresin_amount +
                            self.predict_herbalcannabis(total_amount) * herbalcannabis_amount
                           )/ total_amount
        return starting
    

        
    def explain(self, x):
        message = dict()
        # input is described here
        self_consume = x[0]
        assist_authorities = x[1]
        other_mitigating = x[2]
        refugee = x[3]
        bail = x[4]
        persistent = x[5]
        international = x[6]
        cocaine_amount = x[7]
        heroin_amount = x[8]
        meth_amount = x[9]
        ketamine_amount = x[10]
        nimetazepam_amount = x[11]
        ecstasy_amount = x[12]
        cannabisresin_amount = x[13]
        herbalcannabis_amount = x[14]
        plea_early = x[15]
        plea_late = x[16]
        total_amount = cocaine_amount + heroin_amount + \
                       meth_amount + ketamine_amount + \
                    nimetazepam_amount + ecstasy_amount +\
                        cannabisresin_amount + herbalcannabis_amount
        starting_point = self.get_starting_point(cocaine_amount, heroin_amount,
                                           meth_amount, ketamine_amount,
                                           nimetazepam_amount, ecstasy_amount,
                                           cannabisresin_amount, herbalcannabis_amount)
        sentence = int(starting_point)
        message['starting_point'] = sentence
        message['mitigating_factors'] = []
        message['aggravating_factors'] = []

        if refugee:
            adj = int(starting_point * 0.0595)
            sentence += adj
            message['aggravating_factors'].append({"name": "agrcrc", "adjustment": abs(adj)})

        if bail:
            adj = int(starting_point * 0.0411)
            sentence += adj
            message['aggravating_factors'].append({"name": "agcobcob", "adjustment": abs(adj)})
            
        if persistent:
            adj = int(starting_point * 0.0591)
            sentence += adj
            message['aggravating_factors'].append({"name": "agpopo", "adjustment": abs(adj)})

        if international:
            ## This is based on a CA case
            # if (cocaine_amount > 0 or heroin_amount > 0 or meth_amount > 0) and ketamine_amount == 0:
            #     if total_amount < 250:
            #         adj = 6
            #     elif total_amount < 500:
            #         adj = self.interpolate_sentence(6, 12, 250, 500, total_amount)
            #     elif total_amount < 1000:
            #         adj =  self.interpolate_sentence(12, 24, 500, 1000, total_amount)
            #     else:
            #         adj =  min(starting_point * 0.0519, 24)
            # else:
            adj = int(starting_point * 0.0519)
            sentence += adj
            message['aggravating_factors'].append({"name": "agcbtcbt", "adjustment": abs(adj)})

        self_consume = x[0]
        if self_consume:
            adj = int(starting_point * -0.1)
            sentence += adj
            message['mitigating_factors'].append({"name": "mfscsc", "adjustment": abs(adj)})

        message['sentence_after_trial'] = sentence
        sentence_after_trial = sentence # to be used for mitigating factors

        if sum(x[15:17]) > 0:
            message['plea'] = dict()
            # message['plea']['sentence_before_plea'] = sentence
            
            if plea_early :
                adj = sentence * -1/3
                sentence += adj
                message['plea']['name'] = "pgespleadguilty(earlystage)"
                message['plea']['adj_frac'] = "pp13"
                message['plea']['adj_month'] = str(abs(int(adj)))
                
            elif plea_late:
                adj = sentence * -1/4
                adj_20 = sentence * -1/5
                message['plea']['name'] = "pglspleadguilty(latestage)"
                message['plea']['adj_frac'] = "<25%"
                message['plea']['adj_month'] = '<' + str(abs(int(adj)))
                
                breakdown = []
                breakdown.append(str(int(sentence + adj)))
                breakdown.append("ppbtdf")
                breakdown.append(str(int(sentence + adj)) + "-" + str(int(sentence + adj_20)))
                breakdown.append("ppbtbt")
                breakdown.append(str(int(sentence + adj_20)))
                breakdown.append("ppfdt")
                breakdown.append(str(int(sentence + adj_20)) + "-" + str(int(sentence)))
                breakdown.append("ppdtdt")
                
                message['plea']['breakdown'] = breakdown
                
                sentence += adj



        assist_authorities = x[1]
        other_mitigating = x[2]

        if assist_authorities == 1:
            adj = int(sentence_after_trial * -0.05)
            sentence += adj
            message['mitigating_factors'].append({"name": "mfaauf", "adjustment": abs(adj), "group": "mfaaaa"})

        if assist_authorities == 2:
            adj = int(sentence_after_trial * -0.1)
            sentence += adj
            message['mitigating_factors'].append({"name": "mfaala", "adjustment": abs(adj), "group": "mfaaaa"})

        if assist_authorities == 3:
            adj = int(sentence_after_trial * -0.167)
            sentence += adj
            message['mitigating_factors'].append({"name": "mfaatt", "adjustment": abs(adj), "group": "mfaaaa"})

        if assist_authorities == 4:
            adj = int(sentence_after_trial * -0.25)
            sentence += adj
            message['mitigating_factors'].append({"name": "mfaagr", "adjustment": abs(adj), "group": "mfaaaa"})
     
        if other_mitigating:
            adj = -2
            sentence += adj
            message['mitigating_factors'].append({"name": "mfomom", "adjustment": abs(adj)})
        
        message['final_sentence'] = int(sentence)
        
        
        
        return message

if __name__ == '__main__':
    predictor = DkPredictor()
    #run the script with:
    #  python main.py [0,0,1,0,0,0,0,0,1,100,0,0,100,0,0,0,0,1,0]
    #  python main.py [1,2,0,0,0,0,1,100,0,0,100,0,0,0,0,1,0]
    msg = predictor.explain(json.loads(sys.argv[1]))
    

    print(json.dumps(msg))
    sys.stdout.flush()